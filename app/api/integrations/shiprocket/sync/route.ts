export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { syncShiprocketForConnection } from '@/lib/integrations/shiprocket-sync'

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

  try {
    const result = await syncShiprocketForConnection(connection.id)
    return NextResponse.json({
      success: true,
      warning: result?.warning ?? undefined,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
