export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { workspaceId, selectedCustomerIds } = body as {
    workspaceId?: string
    selectedCustomerIds?: string[]
  }

  if (!workspaceId || !Array.isArray(selectedCustomerIds) || selectedCustomerIds.length === 0) {
    return NextResponse.json(
      { error: 'workspaceId and selectedCustomerIds[] are required' },
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
    return NextResponse.json({ error: 'No active Google Ads connection found' }, { status: 404 })
  }

  const invalid = selectedCustomerIds.filter((id) => !connection.customer_ids.includes(id))
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `These customer IDs are not available: ${invalid.join(', ')}` },
      { status: 400 }
    )
  }

  await prisma.google_ads_connections.update({
    where: { id: connection.id },
    data: {
      selected_customer_ids: selectedCustomerIds,
      selected_customer_id: selectedCustomerIds.length === 1 ? selectedCustomerIds[0] : null,
    },
  })

  return NextResponse.json({ ok: true, selectedCustomerIds })
}
