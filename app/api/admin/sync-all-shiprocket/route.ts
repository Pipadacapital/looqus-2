export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSuperadmin } from '@/lib/require-superadmin'
import { syncAllShiprocket } from '@/lib/integrations/shiprocket-sync'

/**
 * Sync Shiprocket data (orders + shipments) for all workspaces with a connected Shiprocket connection.
 * Superadmin only.
 */
export async function POST() {
  const auth = await requireSuperadmin()
  if ('error' in auth) return auth.error

  try {
    const { synced, failed, results } = await syncAllShiprocket()
    return NextResponse.json({
      success: true,
      synced,
      failed,
      total: results.length,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Shiprocket sync failed',
      },
      { status: 500 }
    )
  }
}

/**
 * GET: list all Shiprocket connections (any status). Only CONNECTED are synced.
 * Superadmin only.
 */
export async function GET() {
  const auth = await requireSuperadmin()
  if ('error' in auth) return auth.error

  const connections = await prisma.shiprocketConnection.findMany({
    select: {
      id: true,
      workspaceId: true,
      email: true,
      status: true,
      lastSyncAt: true,
      lastSyncError: true,
      workspace: { select: { name: true, slug: true } },
    },
  })

  return NextResponse.json({
    connections: connections.map((c) => ({
      connectionId: c.id,
      workspaceId: c.workspaceId,
      workspaceName: c.workspace?.name ?? 'Unknown',
      workspaceSlug: c.workspace?.slug ?? null,
      email: c.email,
      status: c.status,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      lastSyncError: c.lastSyncError,
    })),
    total: connections.length,
  })
}
