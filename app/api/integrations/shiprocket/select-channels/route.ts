export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'

export async function POST(request: NextRequest) {
  let body: { workspaceId: string; selectedChannelIds: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!body.workspaceId || !Array.isArray(body.selectedChannelIds)) {
    return NextResponse.json(
      { error: 'Missing workspaceId or selectedChannelIds' },
      { status: 400 }
    )
  }

  const auth = await requireWorkspaceAdmin(body.workspaceId)
  if ('error' in auth) return auth.error

  const connection = await prisma.shiprocketConnection.findUnique({
    where: { workspaceId: body.workspaceId },
    select: { id: true, status: true, channels: true },
  })

  if (!connection || connection.status !== 'CONNECTED') {
    return NextResponse.json(
      { error: 'No active Shiprocket connection' },
      { status: 404 }
    )
  }

  const knownIds = new Set<string>()
  if (Array.isArray(connection.channels)) {
    for (const ch of connection.channels as Array<{ id: unknown }>) {
      if (ch?.id != null) knownIds.add(String(ch.id))
    }
  }

  const invalid = body.selectedChannelIds.filter((id) => !knownIds.has(id))
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Unknown channel IDs: ${invalid.join(', ')}` },
      { status: 400 }
    )
  }

  await prisma.shiprocketConnection.update({
    where: { id: connection.id },
    data: { selectedChannelIds: body.selectedChannelIds },
  })

  return NextResponse.json({ ok: true, selectedChannelIds: body.selectedChannelIds })
}
