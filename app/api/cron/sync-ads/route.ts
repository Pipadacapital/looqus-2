export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { syncAllMetaAds } from '@/lib/integrations/meta-sync'
import { syncAllGoogleAds } from '@/lib/integrations/google-sync'

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get('x-cron-secret')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const results: Record<string, string> = {}

  try {
    await syncAllMetaAds()
    results.meta = 'ok'
  } catch (err) {
    results.meta = err instanceof Error ? err.message : 'failed'
  }

  try {
    await syncAllGoogleAds()
    results.google = 'ok'
  } catch (err) {
    results.google = err instanceof Error ? err.message : 'failed'
  }

  return NextResponse.json({ results })
}
