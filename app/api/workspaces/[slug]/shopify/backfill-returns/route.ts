import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { syncShopifyAnalyticsFromOrders } from '@/lib/shopify/analytics-sync'

const CHUNK_DAYS = 90

/**
 * POST: Re-sync Shopify analytics (including total_returns and returns from ShopifyQL)
 * for the full historical date range. Owner-only. Populates shopify_analytics_daily
 * from Shopify analytics, not from orders.
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
    return NextResponse.json({ error: 'Only workspace owners can run this backfill' }, { status: 403 })
  }

  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return NextResponse.json(
      { error: 'No connected Shopify store for this workspace' },
      { status: 400 }
    )
  }

  // Use full historical range: from shopify_orders (so we backfill even when analytics_daily has no rows before a date)
  const [ordersRange, analyticsRange] = await Promise.all([
    prisma.shopifyOrder.aggregate({
      where: { connectionId },
      _min: { processedAt: true },
      _max: { processedAt: true },
    }),
    prisma.shopifyAnalyticsDaily.aggregate({
      where: { connectionId },
      _min: { date: true },
      _max: { date: true },
    }),
  ])

  const ordersMin = ordersRange._min.processedAt
  const ordersMax = ordersRange._max.processedAt
  const analyticsMin = analyticsRange._min.date
  const analyticsMax = analyticsRange._max.date

  const minDate =
    ordersMin && analyticsMin
      ? ordersMin < analyticsMin
        ? ordersMin
        : analyticsMin
      : ordersMin ?? analyticsMin ?? null
  const maxDate =
    ordersMax && analyticsMax
      ? ordersMax > analyticsMax
        ? ordersMax
        : analyticsMax
      : ordersMax ?? analyticsMax ?? null
  if (!minDate || !maxDate) {
    return NextResponse.json(
      { error: 'No shopify_orders or shopify_analytics_daily rows; sync orders first' },
      { status: 400 }
    )
  }

  const fromStart = new Date(minDate).toISOString().slice(0, 10)
  const toEnd = new Date(maxDate).toISOString().slice(0, 10)

  let totalUpserted = 0
  let chunkFrom = new Date(fromStart + 'T00:00:00.000Z')
  const end = new Date(toEnd + 'T23:59:59.999Z')

  while (chunkFrom <= end) {
    const chunkTo = new Date(chunkFrom)
    chunkTo.setUTCDate(chunkTo.getUTCDate() + CHUNK_DAYS - 1)
    if (chunkTo > end) chunkTo.setTime(end.getTime())
    const from = chunkFrom.toISOString().slice(0, 10)
    const to = chunkTo.toISOString().slice(0, 10)
    console.log('[backfill-returns] chunk date range:', from, '→', to)
    const { daysUpserted } = await syncShopifyAnalyticsFromOrders(connectionId, from, to)
    totalUpserted += daysUpserted
    chunkFrom.setUTCDate(chunkFrom.getUTCDate() + CHUNK_DAYS)
  }

  return NextResponse.json({
    ok: true,
    message: 'Backfill complete (Shopify analytics sync with total_returns and returns)',
    from: fromStart,
    to: toEnd,
    dailyRowsUpdated: totalUpserted,
  })
}
