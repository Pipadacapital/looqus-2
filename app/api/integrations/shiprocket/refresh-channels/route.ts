export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { discoverChannels } from '@/lib/integrations/shiprocket-sync'

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

  const connection = await prisma.shiprocketConnection.findUnique({
    where: { workspaceId: body.workspaceId },
    select: { id: true, status: true },
  })

  if (!connection || connection.status !== 'CONNECTED') {
    return NextResponse.json(
      { error: 'No active Shiprocket connection' },
      { status: 404 }
    )
  }

  try {
    const channels = await discoverChannels(connection.id)
    const updated = await prisma.shiprocketConnection.findUnique({
      where: { id: connection.id },
      select: { channels: true, selectedChannelIds: true },
    })
    return NextResponse.json({
      ok: true,
      channels,
      selectedChannelIds: updated?.selectedChannelIds ?? [],
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch channels' },
      { status: 500 }
    )
  }
}
