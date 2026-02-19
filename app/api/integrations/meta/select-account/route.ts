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

  const connection = await prisma.metaAdsConnection.findUnique({
    where: { workspaceId },
    select: { id: true, adAccountIds: true, status: true },
  })

  if (!connection || connection.status !== 'CONNECTED') {
    return NextResponse.json(
      { error: 'No active Meta Ads connection found' },
      { status: 404 }
    )
  }

  if (!connection.adAccountIds.includes(selectedAdAccountId)) {
    return NextResponse.json(
      { error: 'Selected ad account is not in the list of connected accounts' },
      { status: 400 }
    )
  }

  await prisma.metaAdsConnection.update({
    where: { id: connection.id },
    data: { selectedAdAccountId },
  })

  return NextResponse.json({ ok: true, selectedAdAccountId })
}
