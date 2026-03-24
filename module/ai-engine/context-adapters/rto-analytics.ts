import type { PrismaClient } from '@prisma/client'
import { buildShiprocketDateRangeWhere, getEffectiveShipmentDate } from '@/lib/shiprocket-list'
import { rtoChargesFromRaw } from '@/lib/shiprocket-charges'
import { getCourierName, isCodShipment } from '@/lib/shiprocket-normalize'
import type { PageContext, CompressedDailyRow } from './types'

function computePriorPeriod(from: Date, to: Date) {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

export type RtoCourierSummary = {
  courierName: string
  rtoCount: number
  rtoRate: number | null
  rtoCost: number
  revenueLost: number
  totalShipments: number
}

export type RtoProductSummary = {
  productTitle: string
  quantity: number
  revenueLost: number
}

type RtoComputeResult = {
  summary: Record<string, number | null>
  daily: CompressedDailyRow[]
  byCourier: RtoCourierSummary[]
  byProduct: RtoProductSummary[]
}

async function computeRtoData(
  prisma: PrismaClient,
  shiprocketConnectionId: string,
  shopifyConnectionId: string | null,
  fromDate: Date,
  toDate: Date
): Promise<RtoComputeResult> {
  const dateWhere = buildShiprocketDateRangeWhere(fromDate, toDate)

  const shipments = await prisma.shiprocketShipment.findMany({
    where: { connectionId: shiprocketConnectionId, ...dateWhere },
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
      shippedAt: true,
      shiprocketCreatedAt: true,
      syncedAt: true,
    },
  })

  if (shipments.length === 0) {
    return { summary: {}, daily: [], byCourier: [], byProduct: [] }
  }

  const totalShipments = shipments.length
  const rtoShipments = shipments.filter((s) => (s.status ?? '').toUpperCase().includes('RTO'))
  const rtoCount = rtoShipments.length
  const rtoRatePercent = totalShipments > 0
    ? Math.round((rtoCount / totalShipments) * 10000) / 100
    : null

  // Per-shipment charges + revenue lost
  let totalRtoCost = 0
  let revenueLostToRto = 0
  let codRtoCount = 0
  let prepaidRtoCount = 0
  let codRtoCost = 0
  let prepaidRtoCost = 0
  let codRevenueLost = 0
  let prepaidRevenueLost = 0

  // Fetch order totals for prepaid revenue lost
  const shiprocketOrderIds = [...new Set(rtoShipments.map((s) => s.orderId).filter(Boolean))] as string[]
  const orderTotals = new Map<string, number>()
  if (shiprocketOrderIds.length > 0) {
    const orders = await prisma.shiprocketOrder.findMany({
      where: { connectionId: shiprocketConnectionId, shiprocketId: { in: shiprocketOrderIds } },
      select: { shiprocketId: true, total: true },
    })
    for (const o of orders) {
      const t = o.total != null ? Number(o.total) : null
      if (t != null && t > 0) orderTotals.set(o.shiprocketId, t)
    }
  }

  const dailyMap = new Map<string, { rtoCount: number; rtoCost: number; revenueLost: number; totalShipments: number }>()
  const courierMap = new Map<string, { rtoCount: number; rtoCost: number; revenueLost: number; totalShipments: number }>()

  // Total shipments by courier (for rtoRate calculation)
  for (const s of shipments) {
    const courier = getCourierName(s)
    const entry = courierMap.get(courier) ?? { rtoCount: 0, rtoCost: 0, revenueLost: 0, totalShipments: 0 }
    entry.totalShipments++
    courierMap.set(courier, entry)

    // Daily totals (all shipments for rate calculation)
    const effectiveDate = getEffectiveShipmentDate(s)
    if (effectiveDate) {
      const dateStr = effectiveDate.toISOString().slice(0, 10)
      const d = dailyMap.get(dateStr) ?? { rtoCount: 0, rtoCost: 0, revenueLost: 0, totalShipments: 0 }
      d.totalShipments++
      dailyMap.set(dateStr, d)
    }
  }

  for (const s of rtoShipments) {
    const cost = rtoChargesFromRaw(s.rawJson)
    const isCod = isCodShipment(s)
    const codAmount = s.codAmount != null ? Number(s.codAmount) : null
    const orderTotal = s.orderId ? orderTotals.get(s.orderId) ?? null : null

    // Revenue lost: COD orders → cod_amount, prepaid → order total
    const revLost = isCod
      ? (codAmount ?? 0)
      : (orderTotal ?? 0)

    totalRtoCost += cost
    revenueLostToRto += revLost

    if (isCod) {
      codRtoCount++
      codRtoCost += cost
      codRevenueLost += revLost
    } else {
      prepaidRtoCount++
      prepaidRtoCost += cost
      prepaidRevenueLost += revLost
    }

    // Courier breakdown
    const courier = getCourierName(s)
    const cEntry = courierMap.get(courier) ?? { rtoCount: 0, rtoCost: 0, revenueLost: 0, totalShipments: 0 }
    cEntry.rtoCount++
    cEntry.rtoCost += cost
    cEntry.revenueLost += revLost
    courierMap.set(courier, cEntry)

    // Daily breakdown
    const effectiveDate = getEffectiveShipmentDate(s)
    if (effectiveDate) {
      const dateStr = effectiveDate.toISOString().slice(0, 10)
      const d = dailyMap.get(dateStr) ?? { rtoCount: 0, rtoCost: 0, revenueLost: 0, totalShipments: 0 }
      d.rtoCount++
      d.rtoCost += cost
      d.revenueLost += revLost
      dailyMap.set(dateStr, d)
    }
  }

  const codRtoRate = codRtoCount + prepaidRtoCount > 0 && totalShipments > 0
    ? Math.round((codRtoCount / (codRtoCount > 0 ? Math.max(codRtoCount + prepaidRtoCount, 1) : 1)) * 10000) / 100
    : null

  // COD total shipments for COD-specific rate
  const codTotalShipments = shipments.filter((s) => isCodShipment(s)).length
  const prepaidTotalShipments = totalShipments - codTotalShipments
  const codRtoRatePercent = codTotalShipments > 0
    ? Math.round((codRtoCount / codTotalShipments) * 10000) / 100
    : null
  const prepaidRtoRatePercent = prepaidTotalShipments > 0
    ? Math.round((prepaidRtoCount / prepaidTotalShipments) * 10000) / 100
    : null

  // Shopify product breakdown for top RTOs
  let byProduct: RtoProductSummary[] = []
  if (shopifyConnectionId && rtoShipments.length > 0) {
    const channelIds = rtoShipments
      .map((s) => s.channelOrderId)
      .filter((id): id is string => id != null && id !== '')
    const cleanIds = channelIds.map((id) => id.replace(/^#/, '').trim())
    if (cleanIds.length > 0) {
      const matchedOrders = await prisma.shopifyOrder.findMany({
        where: {
          connectionId: shopifyConnectionId,
          OR: [{ orderNumber: { in: cleanIds } }, { name: { in: channelIds } }],
        },
        select: { id: true },
      })
      const matchedOrderIds = matchedOrders.map((o) => o.id)
      if (matchedOrderIds.length > 0) {
        const lineItems = await prisma.shopifyLineItem.findMany({
          where: { connectionId: shopifyConnectionId, orderId: { in: matchedOrderIds } },
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
          .slice(0, 8)
      }
    }
  }

  const summary: Record<string, number | null> = {
    totalShipments,
    rtoCount,
    rtoRatePercent,
    totalRtoCost: Math.round(totalRtoCost * 100) / 100,
    revenueLostToRto: Math.round(revenueLostToRto * 100) / 100,
    codRtoCount,
    prepaidRtoCount,
    codTotalShipments,
    prepaidTotalShipments,
    codRtoRatePercent,
    prepaidRtoRatePercent,
    codRtoCost: Math.round(codRtoCost * 100) / 100,
    prepaidRtoCost: Math.round(prepaidRtoCost * 100) / 100,
    codRevenueLost: Math.round(codRevenueLost * 100) / 100,
    prepaidRevenueLost: Math.round(prepaidRevenueLost * 100) / 100,
    avgRtoCostPerShipment: rtoCount > 0 ? Math.round((totalRtoCost / rtoCount) * 100) / 100 : null,
    totalLossPerRto: rtoCount > 0 ? Math.round(((totalRtoCost + revenueLostToRto) / rtoCount) * 100) / 100 : null,
  }

  // Daily rows capped at 30, sorted ascending
  const daily: CompressedDailyRow[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, d]) => ({
      date,
      rtoCount: d.rtoCount,
      rtoRate: d.totalShipments > 0
        ? Math.round((d.rtoCount / d.totalShipments) * 10000) / 100
        : 0,
      rtoCost: Math.round(d.rtoCost * 100) / 100,
      revenueLost: Math.round(d.revenueLost * 100) / 100,
      totalShipments: d.totalShipments,
    }))

  // Couriers by RTO count (top 8)
  const byCourier: RtoCourierSummary[] = Array.from(courierMap.entries())
    .filter(([, c]) => c.rtoCount > 0)
    .map(([courierName, c]) => ({
      courierName,
      rtoCount: c.rtoCount,
      rtoRate: c.totalShipments > 0 ? Math.round((c.rtoCount / c.totalShipments) * 10000) / 100 : null,
      rtoCost: Math.round(c.rtoCost * 100) / 100,
      revenueLost: Math.round(c.revenueLost * 100) / 100,
      totalShipments: c.totalShipments,
    }))
    .sort((a, b) => b.rtoCount - a.rtoCount)
    .slice(0, 8)

  return { summary, daily, byCourier, byProduct }
}

export async function buildRtoAnalyticsContext(
  prisma: PrismaClient,
  workspaceId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<PageContext> {
  const priorRange = computePriorPeriod(dateFrom, dateTo)

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      id: true,
      shiprocketConnection: { select: { id: true, status: true } },
      shopifyConnections: { select: { id: true }, take: 1 },
    },
  })

  const empty: PageContext = {
    page: 'rto-analytics',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: {},
    priorSummary: {},
    daily: [],
    currency: 'INR',
  }

  const srConn = workspace.shiprocketConnection?.status === 'CONNECTED'
    ? workspace.shiprocketConnection
    : null

  if (!srConn) return empty

  const shopifyConnectionId = workspace.shopifyConnections[0]?.id ?? null

  const [current, prior] = await Promise.all([
    computeRtoData(prisma, srConn.id, shopifyConnectionId, dateFrom, dateTo),
    computeRtoData(prisma, srConn.id, shopifyConnectionId, priorRange.from, priorRange.to),
  ])

  return {
    page: 'rto-analytics',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: current.summary,
    priorSummary: prior.summary,
    daily: current.daily,
    currency: 'INR',
    extra: {
      byCourier: current.byCourier,
      priorByCourier: prior.byCourier,
      byProduct: current.byProduct,
    },
  }
}
