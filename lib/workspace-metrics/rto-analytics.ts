/**
 * RTO Analytics v1. Shiprocket-first: same shipment set and RTO definition as Shiprocket/Logistics (status contains 'RTO').
 * Revenue Lost to RTO = Shiprocket-native order/shipment value (cod_amount for COD, order total for prepaid). No Shopify dependency for main KPI.
 * By-product table remains optional Shopify enrichment (mapped orders only).
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { buildShiprocketDateRangeWhere } from '@/lib/shiprocket-list'
import { rtoChargesFromRaw, shiprocketRtoRevenueLost } from '@/lib/shiprocket-charges'
import { getCourierName, isCodShipment } from '@/lib/shiprocket-normalize'

export type RtoAnalyticsByPaymentMethod = {
  paymentMethod: 'COD' | 'Prepaid'
  rtoCount: number
  rtoCost: number
  revenueLost: number
}

export type RtoAnalyticsByCourier = {
  courierName: string
  rtoCount: number
  rtoCost: number
  revenueLost: number
}

export type RtoAnalyticsByProduct = {
  productTitle: string
  quantity: number
  revenueLost: number
}

export type RtoAnalyticsResult = {
  from: string
  to: string
  totalShipments: number
  rtoCount: number
  rtoRatePercent: number | null
  totalRtoCost: number
  revenueLostToRto: number
  byPaymentMethod: RtoAnalyticsByPaymentMethod[]
  byCourier: RtoAnalyticsByCourier[]
  byProduct: RtoAnalyticsByProduct[]
  /** RTO shipments that matched a Shopify order passing workspace filter (for revenue/product). */
  rtoMappedCount: number
  /** RTO shipments with no matching order or order excluded by filter. */
  rtoUnmappedCount: number
}

function isRtoByStatus(status: string | null): boolean {
  return (status ?? '').toUpperCase().includes('RTO')
}

export type WorkspaceForRtoAnalytics = {
  id: string
  skippedShopifyOrderTags?: string[] | null
  skipZeroSalesOrders?: boolean | null
}

/**
 * RTO Analytics for a date range. Shiprocket-first; applies workspace order filter to revenue/product.
 */
export async function getRtoAnalytics(
  prisma: PrismaClient,
  shiprocketConnectionId: string,
  fromDate: Date,
  toDate: Date,
  options: {
    workspace: WorkspaceForRtoAnalytics
    shopifyConnectionId: string | null
    orderInclusionWhere: Prisma.ShopifyOrderWhereInput
  }
): Promise<RtoAnalyticsResult> {
  const fromStr = fromDate.toISOString().slice(0, 10)
  const toStr = toDate.toISOString().slice(0, 10)
  const dateWhere = buildShiprocketDateRangeWhere(fromDate, toDate)

  const shipments = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId: shiprocketConnectionId,
      ...dateWhere,
    },
    select: {
      id: true,
      status: true,
      orderId: true,
      channelOrderId: true,
      courierName: true,
      isCod: true,
      codAmount: true,
      paymentMethod: true,
      rawJson: true,
    },
  })

  const totalShipments = shipments.length
  const rtoShipments = shipments.filter((s) => isRtoByStatus(s.status))
  const rtoCount = rtoShipments.length
  const rtoRatePercent =
    totalShipments > 0 ? Math.round((rtoCount / totalShipments) * 10000) / 100 : null

  const orderIds = [...new Set(rtoShipments.map((s) => s.orderId).filter(Boolean))] as string[]
  const orderTotals = new Map<string, number>()
  if (orderIds.length > 0) {
    const orders = await prisma.shiprocketOrder.findMany({
      where: { connectionId: shiprocketConnectionId, shiprocketId: { in: orderIds } },
      select: { shiprocketId: true, total: true },
    })
    for (const o of orders) {
      const t = o.total != null ? Number(o.total) : null
      if (t != null && t > 0) orderTotals.set(o.shiprocketId, t)
    }
  }

  let totalRtoCost = 0
  let revenueLostToRto = 0
  const byPaymentMap = new Map<'COD' | 'Prepaid', { count: number; cost: number; revenueLost: number }>([
    ['COD', { count: 0, cost: 0, revenueLost: 0 }],
    ['Prepaid', { count: 0, cost: 0, revenueLost: 0 }],
  ])
  const byCourierMap = new Map<string, { count: number; cost: number; revenueLost: number }>()

  for (const s of rtoShipments) {
    const cost = rtoChargesFromRaw(s.rawJson)
    totalRtoCost += cost
    const codAmount = s.codAmount != null ? Number(s.codAmount) : null
    const orderTotal = s.orderId ? orderTotals.get(s.orderId) ?? null : null
    const value = shiprocketRtoRevenueLost(
      { codAmount, isCod: s.isCod },
      s.rawJson,
      orderTotal
    )
    revenueLostToRto += value
    const paymentMethod = isCodShipment(s) ? 'COD' : 'Prepaid'
    const pm = byPaymentMap.get(paymentMethod)!
    pm.count++
    pm.cost += cost
    pm.revenueLost += value
    const courier = getCourierName(s)
    const cur = byCourierMap.get(courier) ?? { count: 0, cost: 0, revenueLost: 0 }
    cur.count++
    cur.cost += cost
    cur.revenueLost += value
    byCourierMap.set(courier, cur)
  }

  let rtoMappedCount = 0
  const rtoOrderIds = new Set<string>()
  if (options.shopifyConnectionId && rtoShipments.length > 0) {
    const channelIds = rtoShipments
      .map((s) => s.channelOrderId)
      .filter((id): id is string => id != null && id !== '')
    const cleanIds = channelIds.map((id) => id.replace(/^#/, '').trim())
    const orderWhere: Prisma.ShopifyOrderWhereInput = {
      connectionId: options.shopifyConnectionId,
      OR: [
        { orderNumber: { in: cleanIds } },
        { name: { in: channelIds } },
      ],
      ...options.orderInclusionWhere,
    }
    const matchedOrders = await prisma.shopifyOrder.findMany({
      where: orderWhere,
      select: { id: true, orderNumber: true, name: true },
    })
    const matchedRefs = new Set(
      matchedOrders.flatMap((o) => [o.orderNumber.replace(/^#/, '').trim(), o.name.replace(/^#/, '').trim()])
    )
    for (const s of rtoShipments) {
      const ref = (s.channelOrderId ?? '').replace(/^#/, '').trim()
      if (ref && matchedRefs.has(ref)) rtoMappedCount++
    }
    for (const o of matchedOrders) rtoOrderIds.add(o.id)
  }
  const rtoUnmappedCount = rtoCount - rtoMappedCount

  const codRow = byPaymentMap.get('COD')!
  const prepaidRow = byPaymentMap.get('Prepaid')!
  const byPaymentMethod: RtoAnalyticsByPaymentMethod[] = [
    { paymentMethod: 'COD', rtoCount: codRow.count, rtoCost: Math.round(codRow.cost * 100) / 100, revenueLost: Math.round(codRow.revenueLost * 100) / 100 },
    { paymentMethod: 'Prepaid', rtoCount: prepaidRow.count, rtoCost: Math.round(prepaidRow.cost * 100) / 100, revenueLost: Math.round(prepaidRow.revenueLost * 100) / 100 },
  ]

  const byCourier: RtoAnalyticsByCourier[] = Array.from(byCourierMap.entries())
    .map(([courierName, v]) => ({
      courierName,
      rtoCount: v.count,
      rtoCost: Math.round(v.cost * 100) / 100,
      revenueLost: Math.round(v.revenueLost * 100) / 100,
    }))
    .sort((a, b) => b.rtoCount - a.rtoCount)

  let byProduct: RtoAnalyticsByProduct[] = []
  if (options.shopifyConnectionId && rtoOrderIds.size > 0) {
    const lineItems = await prisma.shopifyLineItem.findMany({
      where: {
        connectionId: options.shopifyConnectionId,
        orderId: { in: Array.from(rtoOrderIds) },
      },
      select: { title: true, quantity: true, price: true },
    })
    const productMap = new Map<string, { quantity: number; revenueLost: number }>()
    for (const li of lineItems) {
      const title = li.title?.trim() || 'Unknown'
      const cur = productMap.get(title) ?? { quantity: 0, revenueLost: 0 }
      cur.quantity += li.quantity
      cur.revenueLost += Number(li.price) * li.quantity
      productMap.set(title, cur)
    }
    byProduct = Array.from(productMap.entries())
      .map(([productTitle, v]) => ({
        productTitle,
        quantity: v.quantity,
        revenueLost: Math.round(v.revenueLost * 100) / 100,
      }))
      .sort((a, b) => b.revenueLost - a.revenueLost)
      .slice(0, 50)
  }

  return {
    from: fromStr,
    to: toStr,
    totalShipments,
    rtoCount,
    rtoRatePercent,
    totalRtoCost: Math.round(totalRtoCost * 100) / 100,
    revenueLostToRto: Math.round(revenueLostToRto * 100) / 100,
    byPaymentMethod,
    byCourier,
    byProduct,
    rtoMappedCount,
    rtoUnmappedCount,
  }
}
