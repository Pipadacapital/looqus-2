export const runtime = 'nodejs'
export const maxDuration = 300

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { syncKlaviyoForWorkspace } from '@/lib/integrations/klaviyo-sync'

export async function POST(request: NextRequest) {
  let body: { workspaceId: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!body.workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }

  const auth = await requireWorkspaceAdmin(body.workspaceId)
  if ('error' in auth) return auth.error

  try {
    const r = await syncKlaviyoForWorkspace(body.workspaceId)
    return NextResponse.json(r)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed'
    await prisma.klaviyoConnection.updateMany({
      where: { workspaceId: body.workspaceId },
      data: { lastSyncError: msg, lastSyncAt: new Date() },
    })
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
