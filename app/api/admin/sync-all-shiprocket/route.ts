export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSuperadmin } from '@/lib/require-superadmin'
import { syncAllShiprocket } from '@/lib/integrations/shiprocket-sync'

/**
 * Sync Shiprocket data (orders + shipments) for all workspaces with a connected Shiprocket connection.
 * Superadmin only. Use ?days=N or body.days to sync last N days (default 1).
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperadmin()
  if ('error' in auth) return auth.error

  let days = 1
  const urlDays = request.nextUrl.searchParams.get('days')
  if (urlDays != null) {
    const n = parseInt(urlDays, 10)
    if (!Number.isNaN(n) && n >= 1 && n <= 365) days = n
  } else {
    try {
      const body = await request.json().catch(() => ({}))
      const bodyDays = body?.days
      if (bodyDays != null) {
        const n = typeof bodyDays === 'number' ? bodyDays : parseInt(String(bodyDays), 10)
        if (!Number.isNaN(n) && n >= 1 && n <= 365) days = n
      }
    } catch {
      // no body or invalid JSON
    }
  }

  try {
    const { synced, failed, results } = await syncAllShiprocket({ days })
    return NextResponse.json({
      success: true,
      days,
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
