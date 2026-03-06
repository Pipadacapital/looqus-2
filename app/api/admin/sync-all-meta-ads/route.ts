export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSuperadmin } from '@/lib/require-superadmin'
import { syncAllMetaAds } from '@/lib/integrations/meta-sync'

/**
 * Sync Meta Ads data for all workspaces (all connected connections).
 * Superadmin only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperadmin()
  if ('error' in auth) return auth.error

  const backfill = request.nextUrl.searchParams.get('backfill') === '1'
  const days = backfill
    ? 730
    : Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 7))

  try {
    const { synced, failed, results } = await syncAllMetaAds(days, { backfill })
    return NextResponse.json({
      success: true,
      synced,
      failed,
      total: results.length,
      days,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      { status: 500 }
    )
  }
}

/**
 * GET: list workspaces that have a connected Meta Ads connection (for UI).
 * Superadmin only.
 */
export async function GET() {
  const auth = await requireSuperadmin()
  if ('error' in auth) return auth.error

  const connections = await prisma.meta_ads_connections.findMany({
    where: { status: 'CONNECTED' },
    select: {
      id: true,
      workspace_id: true,
      selected_ad_account_id: true,
      ad_account_ids: true,
      last_sync_at: true,
      last_sync_error: true,
      workspaces: { select: { name: true, slug: true } },
    },
  })

  return NextResponse.json({
    connections: connections.map((c) => ({
      connectionId: c.id,
      workspaceId: c.workspace_id,
      workspaceName: c.workspaces?.name ?? 'Unknown',
      workspaceSlug: c.workspaces?.slug,
      selectedAdAccountId: c.selected_ad_account_id,
      adAccountCount: c.ad_account_ids?.length ?? 0,
      lastSyncAt: c.last_sync_at?.toISOString() ?? null,
      lastSyncError: c.last_sync_error,
    })),
    total: connections.length,
  })
}
