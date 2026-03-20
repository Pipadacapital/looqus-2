import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { getOrderInclusionWhereFromWorkspace } from '@/lib/order-filters'
import { getPincodeIntelligence } from '@/lib/workspace-metrics/pincode-intelligence'

/**
 * GET /api/workspaces/[slug]/pincode-intelligence
 * Pincode Intelligence v1: aggregate by delivery pincode (from Shiprocket rawJson),
 * with RTO/COD/delivered from Shiprocket and orders/revenue from matched Shopify orders.
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
  const search = searchParams.get('search')?.trim() || null
  const state = searchParams.get('state')?.trim() || null
  const minOrdersParam = searchParams.get('minOrders')
  const minOrders = minOrdersParam != null ? Math.max(0, parseInt(minOrdersParam, 10) || 0) : 0
  const highRtoOnly = searchParams.get('highRto') === '1' || searchParams.get('highRto') === 'true'
  const highCodOnly = searchParams.get('highCod') === '1' || searchParams.get('highCod') === 'true'
  const sort = searchParams.get('sort') || 'orders'
  const order = (searchParams.get('order') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'

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
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const today = new Date()
  today.setUTCHours(23, 59, 59, 999)
  const defaultFrom = new Date(today)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 89)
  defaultFrom.setUTCHours(0, 0, 0, 0)

  const fromStr = typeof fromParam === 'string' ? fromParam : defaultFrom.toISOString().slice(0, 10)
  const toStr = typeof toParam === 'string' ? toParam : today.toISOString().slice(0, 10)
  const fromDate = new Date(fromStr + 'T00:00:00.000Z')
  const toDate = new Date(toStr + 'T23:59:59.999Z')

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json(
      { error: 'Invalid date range' },
      { status: 400 }
    )
  }

  const shiprocketConn =
    workspace.shiprocketConnection?.status === 'CONNECTED' ? workspace.shiprocketConnection : null
  const shopifyConn = workspace.shopifyConnections?.[0] ?? null

  if (!shiprocketConn) {
    return NextResponse.json({
      rows: [],
      totalShipments: 0,
      shipmentsWithPincode: 0,
      matchedShipments: 0,
      caveat: 'Shiprocket not connected. Connect Shiprocket to see pincode intelligence.',
    })
  }

  const orderInclusionWhere = getOrderInclusionWhereFromWorkspace(workspace as any)

  const result = await getPincodeIntelligence(prisma, {
    fromDate,
    toDate,
    shiprocketConnectionId: shiprocketConn.id,
    shopifyConnectionId: shopifyConn?.id ?? null,
    orderInclusionWhere,
    search,
    state,
    minOrders,
    highRtoOnly,
    highCodOnly,
    sort,
    order,
  })

  const caveat =
    result.totalShipments > 0 && result.shipmentsWithPincode === 0
      ? 'Pincode is extracted from Shiprocket shipment payload (order_to_pincode, address.pin_code, etc.). No pincodes found in current data; ensure Shiprocket sync stores full order/shipment payload.'
      : result.totalShipments > 0 && result.matchedShipments != null && result.matchedShipments < result.totalShipments
        ? `Orders and revenue are from Shopify orders matched to shipments (${result.matchedShipments}/${result.totalShipments} shipments matched). RTO/COD/Delivered % are from all shipments.`
        : undefined

  return NextResponse.json({
    from: fromStr,
    to: toStr,
    rows: result.rows,
    totalShipments: result.totalShipments,
    shipmentsWithPincode: result.shipmentsWithPincode,
    matchedShipments: result.matchedShipments,
    caveat,
  })
}
