export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { workspaceId, selectedAdAccountIds } = body as {
    workspaceId?: string
    selectedAdAccountIds?: string[]
  }

  if (!workspaceId || !Array.isArray(selectedAdAccountIds) || selectedAdAccountIds.length === 0) {
    return NextResponse.json(
      { error: 'workspaceId and selectedAdAccountIds[] are required' },
      { status: 400 }
    )
  }

  const result = await requireWorkspaceAdmin(workspaceId)
  if ('error' in result) return result.error

  const connection = await prisma.meta_ads_connections.findUnique({
    where: { workspace_id: workspaceId },
    select: { id: true, ad_account_ids: true, status: true },
  })

  if (!connection || connection.status !== 'CONNECTED') {
    return NextResponse.json({ error: 'No active Meta Ads connection found' }, { status: 404 })
  }

  const invalid = selectedAdAccountIds.filter((id) => !connection.ad_account_ids.includes(id))
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `These account IDs are not available: ${invalid.join(', ')}` },
      { status: 400 }
    )
  }

  await prisma.meta_ads_connections.update({
    where: { id: connection.id },
    data: {
      selected_ad_account_ids: selectedAdAccountIds,
      selected_ad_account_id: selectedAdAccountIds.length === 1 ? selectedAdAccountIds[0] : null,
      updated_at: new Date(),
    },
  })

  return NextResponse.json({ ok: true, selectedAdAccountIds })
}
