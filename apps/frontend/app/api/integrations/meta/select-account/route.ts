export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { workspaceId, selectedAdAccountId } = body as {
    workspaceId?: string
    selectedAdAccountId?: string
  }

  if (!workspaceId || !selectedAdAccountId) {
    return NextResponse.json(
      { error: 'workspaceId and selectedAdAccountId are required' },
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
    return NextResponse.json(
      { error: 'No active Meta Ads connection found' },
      { status: 404 }
    )
  }

  if (!connection.ad_account_ids.includes(selectedAdAccountId)) {
    return NextResponse.json(
      { error: 'Selected ad account is not in the list of connected accounts' },
      { status: 400 }
    )
  }

  await prisma.meta_ads_connections.update({
    where: { id: connection.id },
    data: { selected_ad_account_id: selectedAdAccountId, updated_at: new Date() },
  })

  return NextResponse.json({ ok: true, selectedAdAccountId })
}
