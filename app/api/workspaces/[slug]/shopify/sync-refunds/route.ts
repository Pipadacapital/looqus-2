import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { syncRefunds } from '@/lib/shopify/refund-sync'

/**
 * POST: Sync refund line items from Shopify for this workspace's connection.
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD). Defaults: last 365 days.
 * Uses Shopify Admin GraphQL Order.refunds.refundLineItems as source of truth.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true, shopDomain: true, accessToken: true },
        take: 1,
      },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const connection = workspace.shopifyConnections[0]
  if (!connection?.accessToken) {
    return NextResponse.json(
      { error: 'No connected Shopify store or missing access token' },
      { status: 400 }
    )
  }

  const toDate = toParam
    ? new Date(toParam + 'T23:59:59.999Z')
    : new Date()
  const fromDate = fromParam
    ? new Date(fromParam + 'T00:00:00.000Z')
    : new Date(toDate.getTime() - 365 * 24 * 60 * 60 * 1000)

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid from/to date range' }, { status: 400 })
  }

  try {
    const result = await syncRefunds({
      connectionId: connection.id,
      shopDomain: connection.shopDomain,
      accessToken: connection.accessToken,
      fromDate,
      toDate,
    })
    return NextResponse.json({
      ok: true,
      ...result,
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
