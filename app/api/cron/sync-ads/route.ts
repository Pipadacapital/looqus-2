export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { syncAllMetaAds } from '@/lib/integrations/meta-sync'
import { syncAllGoogleAds } from '@/lib/integrations/google-sync'

/**
 * Hourly cron: syncs only the last 2 days (upsert by date).
 * Does not refetch full history — just keeps recent data updated.
 *
 * Schedule this endpoint every hour using one of:
 * - GitHub Actions (schedule workflow)
 * - cron-job.org / EasyCron (hit URL)
 * - System cron on your server: 0 * * * * curl -X POST -H "x-cron-secret: $CRON_SECRET" https://your-app.com/api/cron/sync-ads
 */
const CRON_SYNC_DAYS = 2

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get('x-cron-secret')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const results: Record<string, string> = {}

  try {
    await syncAllMetaAds(CRON_SYNC_DAYS)
    results.meta = 'ok'
  } catch (err) {
    results.meta = err instanceof Error ? err.message : 'failed'
  }

  try {
    await syncAllGoogleAds(CRON_SYNC_DAYS)
    results.google = 'ok'
  } catch (err) {
    results.google = err instanceof Error ? err.message : 'failed'
  }

  return NextResponse.json({ results })
}
