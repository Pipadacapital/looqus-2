import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'
import { getOrderInclusionWhereFromWorkspace } from '@/lib/order-filters'
import { getRtoAnalytics } from '@/lib/workspace-metrics'

/**
 * GET /api/workspaces/[slug]/rto-analytics
 * RTO Analytics v1: RTO rate, total RTO orders, total RTO cost, revenue lost;
 * breakdowns by COD vs Prepaid, by courier, and by product. Respects workspace order filters.
 */
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
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
      shiprocketConnection: {
        select: { id: true, status: true },
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

  const guard = featureGuard(workspace.features as any, 'rto_analytics')
  if (guard) return guard

  const srConn = workspace.shiprocketConnection?.status === 'CONNECTED'
    ? workspace.shiprocketConnection
    : null

  const today = new Date()
  today.setUTCHours(23, 59, 59, 999)
  const defaultFrom = new Date(today)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 89)
  defaultFrom.setUTCHours(0, 0, 0, 0)
  const fromStr = typeof fromParam === 'string' ? fromParam : defaultFrom.toISOString().slice(0, 10)
  const toStr = typeof toParam === 'string' ? toParam : today.toISOString().slice(0, 10)
  const fromDate = new Date(fromStr + 'T00:00:00.000Z')
  const toDate = new Date(toStr + 'T23:59:59.999Z')

  if (!srConn) {
    return NextResponse.json({
      from: fromStr,
      to: toStr,
      connected: false,
      totalShipments: 0,
      rtoCount: 0,
      rtoRatePercent: null,
      totalRtoCost: 0,
      revenueLostToRto: 0,
      byPaymentMethod: [],
      byCourier: [],
      byProduct: [],
      rtoMappedCount: 0,
      rtoUnmappedCount: 0,
    })
  }

  const shopifyConnectionId = workspace.shopifyConnections[0]?.id ?? null
  const orderInclusionWhere = getOrderInclusionWhereFromWorkspace(workspace as any)

  const result = await getRtoAnalytics(prisma, srConn.id, fromDate, toDate, {
    workspace: {
      id: workspace.id,
      skippedShopifyOrderTags: workspace.skipped_shopify_order_tags,
      skipZeroSalesOrders: workspace.skip_zero_sales_orders,
    },
    shopifyConnectionId,
    orderInclusionWhere,
  })

  return NextResponse.json({
    ...result,
    connected: true,
  })
}
