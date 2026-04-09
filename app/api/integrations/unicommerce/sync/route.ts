export const runtime = 'nodejs'
export const maxDuration = 800

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { syncUnicommerceProducts } from '@/lib/integrations/unicommerce-sync'

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

  const connection = await prisma.unicommerceConnection.findUnique({
    where: { workspaceId: body.workspaceId },
    select: { id: true, status: true },
  })

  if (!connection || connection.status !== 'CONNECTED') {
    return NextResponse.json(
      { error: 'No active Unicommerce connection' },
      { status: 404 }
    )
  }

  try {
    const result = await syncUnicommerceProducts(connection.id)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unicommerce sync failed'
    await prisma.unicommerceConnection.update({
      where: { id: connection.id },
      data: { lastSyncError: message },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
