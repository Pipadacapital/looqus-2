export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'

export async function POST(request: NextRequest) {
  let body: { workspaceId: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { workspaceId } = body
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  const auth = await requireWorkspaceAdmin(workspaceId)
  if ('error' in auth) return auth.error

  await prisma.$transaction([
    prisma.woocommerceConnection.deleteMany({ where: { workspaceId } }),
    prisma.workspace.update({
      where: { id: workspaceId },
      data: { platform: 'SHOPIFY' },
    }),
  ])

  return NextResponse.json({ success: true })
}
