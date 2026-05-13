export const runtime = 'nodejs'
export const maxDuration = 800

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import {
  syncShiprocketForConnection,
  backfillShiprocketCourierNames,
  backfillShiprocketPincodes,
} from '@/lib/integrations/shiprocket-sync'

export async function POST(request: NextRequest) {
  let body: { workspaceId: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!body.workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })
  }

  const auth = await requireWorkspaceAdmin(body.workspaceId)
  if ('error' in auth) return auth.error

  const connection = await prisma.shiprocketConnection.findUnique({
    where: { workspaceId: body.workspaceId },
    select: { id: true, status: true },
  })

  if (!connection || connection.status !== 'CONNECTED') {
    return NextResponse.json(
      { error: 'No active Shiprocket connection' },
      { status: 404 }
    )
  }

  const encode = (data: object) =>
    new TextEncoder().encode(JSON.stringify(data) + '\n')

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encode({
            stage: 'syncing',
            message: 'Syncing shipments from Shiprocket...',
            progress: 10,
          })
        )

        const syncResult = await syncShiprocketForConnection(connection.id)

        controller.enqueue(
          encode({
            stage: 'syncing_done',
            message: 'Synced shipments from Shiprocket',
            progress: 35,
          })
        )

        controller.enqueue(
          encode({
            stage: 'courier',
            message: 'Enriching courier data...',
            progress: 40,
          })
        )

        let courierResult = null
        try {
          courierResult = await backfillShiprocketCourierNames(connection.id)
        } catch (e) {
          console.warn('[sync] courier backfill failed:', e)
        }

        controller.enqueue(
          encode({
            stage: 'courier_done',
            message: `Courier data enriched${
              courierResult?.updatedFromTracking
                ? ` (${courierResult.updatedFromTracking} resolved)`
                : ''
            }`,
            progress: 70,
          })
        )

        controller.enqueue(
          encode({
            stage: 'pincode',
            message: 'Enriching pincode data...',
            progress: 75,
          })
        )

        let pincodeResult = null
        try {
          pincodeResult = await backfillShiprocketPincodes(connection.id)
        } catch (e) {
          console.warn('[sync] pincode backfill failed:', e)
        }

        controller.enqueue(
          encode({
            stage: 'pincode_done',
            message: 'Pincode data enriched',
            progress: 95,
          })
        )

        controller.enqueue(
          encode({
            stage: 'done',
            message: 'Sync complete',
            progress: 100,
            sync: syncResult,
            courierBackfill: courierResult,
            pincodeBackfill: pincodeResult,
          })
        )
      } catch (error) {
        controller.enqueue(
          encode({
            stage: 'error',
            message: error instanceof Error ? error.message : 'Sync failed',
            progress: 0,
          })
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
