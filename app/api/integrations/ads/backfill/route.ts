export const runtime = 'nodejs'
export const maxDuration = 300

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { syncMetaAdsForConnection } from '@/lib/integrations/meta-sync'
import { syncGoogleAdsForConnection } from '@/lib/integrations/google-sync'

/**
 * POST: Run 730-day (configurable) backfill for Meta Ads + Google Ads for a workspace.
 * Query:
 * - workspaceId (required)
 * - provider (optional): omit or `all` — Meta then Google (legacy). `meta` — Meta only. `google` — Google only.
 * Admin/Owner of the workspace only.
 */
export async function POST(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json(
      { error: 'Missing workspaceId query parameter' },
      { status: 400 }
    )
  }

  const providerRaw = request.nextUrl.searchParams.get('provider')
  const provider =
    providerRaw === 'meta' || providerRaw === 'google' ? providerRaw : 'all'

  const auth = await requireWorkspaceAdmin(workspaceId)
  if ('error' in auth) return auth.error

  const metaConn = await prisma.meta_ads_connections.findUnique({
    where: { workspace_id: workspaceId },
    select: { id: true, status: true },
  })
  const googleConn = await prisma.google_ads_connections.findUnique({
    where: { workspace_id: workspaceId },
    select: { id: true, status: true },
  })

  if (provider === 'meta') {
    if (!metaConn || metaConn.status !== 'CONNECTED') {
      return NextResponse.json(
        { error: 'No connected Meta Ads account for this workspace.' },
        { status: 404 }
      )
    }
  } else if (provider === 'google') {
    if (!googleConn || googleConn.status !== 'CONNECTED') {
      return NextResponse.json(
        { error: 'No connected Google Ads account for this workspace.' },
        { status: 404 }
      )
    }
  } else if (!metaConn && !googleConn) {
    return NextResponse.json(
      { error: 'No Meta or Google Ads connection for this workspace' },
      { status: 404 }
    )
  }

  const results: { meta?: { rowsSynced: number }; google?: { rowsSynced: number }; error?: string } = {}

  const runMeta =
    provider === 'all' || provider === 'meta'
      ? metaConn?.status === 'CONNECTED'
      : false
  const runGoogle =
    provider === 'all' || provider === 'google'
      ? googleConn?.status === 'CONNECTED'
      : false

  if (runMeta && metaConn) {
    try {
      const metaResult = await syncMetaAdsForConnection(metaConn.id, { backfill: true })
      results.meta = { rowsSynced: metaResult.rowsSynced }
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Ads backfill] Meta workspace ${workspaceId}: ${metaResult.rowsSynced} rows`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (process.env.NODE_ENV === 'development') {
        console.error('[Ads backfill] Meta failed:', msg)
      }
      results.error = `Meta: ${msg}`
    }
  }

  if (runGoogle && googleConn) {
    try {
      const googleResult = await syncGoogleAdsForConnection(googleConn.id, { backfill: true })
      results.google = { rowsSynced: googleResult.rowsSynced }
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Ads backfill] Google workspace ${workspaceId}: ${googleResult.rowsSynced} rows`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (process.env.NODE_ENV === 'development') {
        console.error('[Ads backfill] Google failed:', msg)
      }
      results.error = results.error ? `${results.error}; Google: ${msg}` : `Google: ${msg}`
    }
  }

  return NextResponse.json({
    success: !results.error,
    workspaceId,
    provider,
    ...results,
  })
}
