import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { syncShopifyAnalyticsFromOrders } from '@/lib/shopify/analytics-sync'

/**
 * POST: Rebuild Shopify returns for a date range.
 * 1) Wipes total_returns and returns to 0 for connection + range
 * 2) Re-fetches from ShopifyQL (sales: total_returns, returns)
 * 3) Writes fresh daily values
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD). Owner-only.
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
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: 'Query params from and to (YYYY-MM-DD) are required' },
      { status: 400 }
    )
  }
  if (from > to) {
    return NextResponse.json({ error: 'from must be <= to' }, { status: 400 })
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
      members: { where: { userId: user.id }, select: { role: true } },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  if (workspace.members[0]?.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only workspace owners can run this' }, { status: 403 })
  }

  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return NextResponse.json(
      { error: 'No connected Shopify store for this workspace' },
      { status: 400 }
    )
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T23:59:59.999Z`)

  const wipe = await prisma.shopifyAnalyticsDaily.updateMany({
    where: {
      connectionId,
      date: { gte: fromDate, lte: toDate },
    },
    data: { total_returns: 0, returns: 0 },
  })

  const { daysUpserted } = await syncShopifyAnalyticsFromOrders(connectionId, from, to)

  return NextResponse.json({
    ok: true,
    message: 'Rebuild complete: wiped then re-synced from ShopifyQL',
    from,
    to,
    rowsWiped: wipe.count,
    dailyRowsUpdated: daysUpserted,
  })
}
