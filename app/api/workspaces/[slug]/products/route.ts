import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { computeProducts, computeWoocommerceProducts } from '@/lib/products/compute'
import type { ProductsGroupBy, ProductsSortColumn } from '@/lib/products/types'

const GROUP_BY_VALUES: ProductsGroupBy[] = [
  'product',
  'variant',
  'collection',
  'vendor',
  'type',
  'product_tags',
  'order_tags',
  'discount_codes',
]

const SORT_COLUMNS: ProductsSortColumn[] = [
  'label',
  'pareto_grade',
  'cm1',
  'cm1_pct',
  'cm1_total',
  'sales',
  'refunds',
  'revenue',
  'sold',
  'refunded',
  'net_quantity',
  'return_rate',
  'nc_return_rate',
  'ec_return_rate',
  'orders',
  'nc_orders',
  'ec_orders',
  'aov',
  'nc_aov',
  'ec_aov',
]

function parseDate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

export async function GET(
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
  const from = parseDate(searchParams.get('from'))
  const to = parseDate(searchParams.get('to'))
  const groupBy = (searchParams.get('groupBy') ?? 'product') as ProductsGroupBy
  const sort = (searchParams.get('sort') ?? 'cm1') as ProductsSortColumn
  const dir = (searchParams.get('dir') ?? 'desc') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? '20', 10) || 20))
  const search = searchParams.get('search') ?? undefined

  if (!from || !to) {
    return NextResponse.json(
      { error: 'Missing or invalid from/to (YYYY-MM-DD)' },
      { status: 400 }
    )
  }

  const fromDate = new Date(from + 'T00:00:00.000Z')
  const toDate = new Date(to + 'T23:59:59.999Z')
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  const validGroupBy = GROUP_BY_VALUES.includes(groupBy) ? groupBy : 'product'
  const validSort = SORT_COLUMNS.includes(sort) ? sort : 'cm1'

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const isWoocommerce = workspace.platform === 'WOOCOMMERCE'
  const connectionId = workspace.shopifyConnections?.[0]?.id ?? null
  if (process.env.NODE_ENV === 'development' && !isWoocommerce) {
    const [ordersCount, lineItemsCount, dailyCount, refundCount] = await Promise.all([
      connectionId
        ? prisma.shopifyOrder.count({
            where: {
              connectionId,
              processedAt: { gte: fromDate, lte: toDate },
            },
          })
        : Promise.resolve(0),
      connectionId
        ? prisma.shopifyLineItem.count({
            where: { connection: { id: connectionId } },
          })
        : Promise.resolve(0),
      connectionId
        ? prisma.shopifyAnalyticsDaily.count({
            where: { connectionId, date: { gte: fromDate, lte: toDate } },
          })
        : Promise.resolve(0),
      connectionId
        ? prisma.shopify_refund_line_items.count({
            where: {
              connection_id: connectionId,
              processed_at: { gte: fromDate, lte: toDate },
            },
          })
        : Promise.resolve(0),
    ])
    console.log('[Products] workspace scope', {
      workspaceId: workspace.id,
      slug,
      connectionId,
      ordersInRange: ordersCount,
      lineItems: lineItemsCount,
      analyticsDaily: dailyCount,
      refundLineItemsInRange: refundCount,
    })
  }

  try {
    if (isWoocommerce) {
      const result = await computeWoocommerceProducts(prisma, workspace.id, {
        from,
        to,
        groupBy: validGroupBy,
        search,
        sort: validSort,
        dir,
        page,
        pageSize,
      })
      return NextResponse.json(result)
    }

    const result = await computeProducts(prisma, workspace as Parameters<typeof computeProducts>[1], {
      from,
      to,
      groupBy: validGroupBy,
      search,
      sort: validSort,
      dir,
      page,
      pageSize,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[Products] computeProducts failed', { slug, workspaceId: workspace.id, message, stack })
    return NextResponse.json(
      { error: 'Products computation failed', details: process.env.NODE_ENV === 'development' ? message : undefined },
      { status: 500 }
    )
  }
}
