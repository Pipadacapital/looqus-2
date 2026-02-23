export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { workspaceId, selectedCustomerId } = body as {
    workspaceId?: string
    selectedCustomerId?: string
  }

  if (!workspaceId || !selectedCustomerId) {
    return NextResponse.json(
      { error: 'workspaceId and selectedCustomerId are required' },
      { status: 400 }
    )
  }

  const result = await requireWorkspaceAdmin(workspaceId)
  if ('error' in result) return result.error

  const connection = await prisma.google_ads_connections.findUnique({
    where: { workspace_id: workspaceId },
    select: { id: true, customer_ids: true, status: true },
  })

  if (!connection || connection.status !== 'CONNECTED') {
    return NextResponse.json(
      { error: 'No active Google Ads connection found' },
      { status: 404 }
    )
  }

  if (!connection.customer_ids.includes(selectedCustomerId)) {
    return NextResponse.json(
      { error: 'Selected customer ID is not in the list of connected customers' },
      { status: 400 }
    )
  }

  await prisma.google_ads_connections.update({
    where: { id: connection.id },
    data: { selected_customer_id: selectedCustomerId },
  })

  return NextResponse.json({ ok: true, selectedCustomerId })
}
