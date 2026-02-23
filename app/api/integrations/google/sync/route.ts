export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { syncGoogleAdsForConnection } from '@/lib/integrations/google-sync'

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

  const connection = await prisma.google_ads_connections.findUnique({
    where: { workspace_id: body.workspaceId },
    select: { id: true, status: true },
  })

  if (!connection || connection.status !== 'CONNECTED') {
    return NextResponse.json(
      { error: 'No active Google Ads connection' },
      { status: 404 }
    )
  }

  try {
    await syncGoogleAdsForConnection(connection.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
