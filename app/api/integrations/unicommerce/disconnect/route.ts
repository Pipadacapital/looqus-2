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

  if (!body.workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })
  }

  const auth = await requireWorkspaceAdmin(body.workspaceId)
  if ('error' in auth) return auth.error

  await prisma.$transaction([
    prisma.unicommerceConnection.deleteMany({
      where: { workspaceId: body.workspaceId },
    }),
    prisma.workspace.updateMany({
      where: {
        id: body.workspaceId,
        productDataSource: 'UNICOMMERCE',
      },
      data: { productDataSource: 'SHOPIFY' },
    }),
  ])

  return NextResponse.json({ success: true })
}
