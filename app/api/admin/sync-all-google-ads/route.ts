export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSuperadmin } from '@/lib/require-superadmin'
import { syncAllGoogleAds } from '@/lib/integrations/google-sync'

/**
 * Sync Google Ads data for all workspaces (all connected connections).
 * Superadmin only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperadmin()
  if ('error' in auth) return auth.error

  const required = [
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REDIRECT_URI',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
  ] as const
  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: 'Google Ads is not configured. Add these to .env: ' + missing.join(', '),
      },
      { status: 503 }
    )
  }

  const days = Math.min(
    90,
    Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 30)
  )

  try {
    const { synced, failed, results } = await syncAllGoogleAds(days)
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
 * GET: list workspaces that have a connected Google Ads connection (for UI).
 * Superadmin only.
 */
export async function GET() {
  const auth = await requireSuperadmin()
  if ('error' in auth) return auth.error

  const connections = await prisma.google_ads_connections.findMany({
    where: { status: 'CONNECTED' },
    select: {
      id: true,
      workspace_id: true,
      selected_customer_id: true,
      customer_ids: true,
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
      selectedCustomerId: c.selected_customer_id,
      customerCount: c.customer_ids?.length ?? 0,
      lastSyncAt: c.last_sync_at?.toISOString() ?? null,
      lastSyncError: c.last_sync_error,
    })),
    total: connections.length,
  })
}
