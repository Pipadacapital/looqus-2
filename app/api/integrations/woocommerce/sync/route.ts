export const runtime = 'nodejs'
export const maxDuration = 800

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { syncWoocommerceForConnection } from '@/lib/integrations/woocommerce-sync'

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

  const connection = await prisma.woocommerceConnection.findUnique({
    where: { workspaceId },
    select: { id: true },
  })

  if (!connection) {
    return NextResponse.json({ error: 'No WooCommerce connection found' }, { status: 404 })
  }

  const result = await syncWoocommerceForConnection(connection.id)

  return NextResponse.json({ success: true, ...result })
}
