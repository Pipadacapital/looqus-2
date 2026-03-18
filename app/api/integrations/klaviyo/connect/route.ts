export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { klaviyoValidateApiKey } from '@/lib/integrations/klaviyo-client'

export async function POST(request: NextRequest) {
  let body: { workspaceId: string; apiKey: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { workspaceId, apiKey } = body
  if (!workspaceId || !apiKey?.trim()) {
    return NextResponse.json({ error: 'workspaceId and apiKey are required' }, { status: 400 })
  }

  const auth = await requireWorkspaceAdmin(workspaceId)
  if ('error' in auth) return auth.error

  try {
    await klaviyoValidateApiKey(apiKey.trim())
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Invalid Klaviyo API key' },
      { status: 400 }
    )
  }

  await prisma.klaviyoConnection.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      apiKey: apiKey.trim(),
      status: 'CONNECTED',
      lastSyncError: null,
    },
    update: {
      apiKey: apiKey.trim(),
      status: 'CONNECTED',
      lastSyncError: null,
      conversionMetricId: null,
    },
  })

  return NextResponse.json({ success: true })
}
