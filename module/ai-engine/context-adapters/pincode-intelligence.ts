import type { PrismaClient } from '@prisma/client'
import { getPincodeIntelligence, type PincodeIntelligenceRow } from '@/lib/workspace-metrics/pincode-intelligence'
import { getOrderInclusionWhere } from '@/lib/order-filters'
import { buildShiprocketDateRangeWhere, getEffectiveShipmentDate } from '@/lib/shiprocket-list'
import type { PageContext, CompressedDailyRow } from './types'

function computePriorPeriod(from: Date, to: Date) {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

export type StateSummary = {
  state: string
  orders: number
  revenue: number
  shipments: number
  rtoCount: number
  rtoPercent: number | null
  codPercent: number | null
  deliveredPercent: number | null
  avgScore: number
  pincodeCount: number
}

export type PincodeSummaryRow = {
  pincode: string
  city: string
  state: string
  orders: number
  revenue: number
  aov: number | null
  rtoPercent: number | null
  codPercent: number | null
  deliveredPercent: number | null
  repeatRate: number | null
  profitabilityScore: number
  tier: 1 | 2 | 3 | null
  topCourier: string
}

function compressRow(r: PincodeIntelligenceRow): PincodeSummaryRow {
  return {
    pincode: r.pincode,
    city: r.city,
    state: r.state,
    orders: r.orders,
    revenue: r.revenue,
    aov: r.aov,
    rtoPercent: r.rtoPercent,
    codPercent: r.codPercent,
    deliveredPercent: r.deliveredPercent,
    repeatRate: r.repeatRate,
    profitabilityScore: r.profitabilityScore,
    tier: r.tier,
    topCourier: r.topCourier,
  }
}

function buildStateSummaries(rows: PincodeIntelligenceRow[]): StateSummary[] {
  const map = new Map<string, {
    orders: number; revenue: number; shipments: number
    rtoCount: number; codCount: number; deliveredCount: number
    scoreSum: number; pincodeCount: number
  }>()

  for (const r of rows) {
    const key = r.state || 'Unknown'
    const entry = map.get(key) ?? {
      orders: 0, revenue: 0, shipments: 0,
      rtoCount: 0, codCount: 0, deliveredCount: 0,
      scoreSum: 0, pincodeCount: 0,
    }
    entry.orders += r.orders
    entry.revenue += r.revenue
    entry.shipments += r.shipmentCount
    entry.rtoCount += r.rtoCount
    entry.codCount += r.codCount
    entry.deliveredCount += r.deliveredCount
    entry.scoreSum += r.profitabilityScore
    entry.pincodeCount++
    map.set(key, entry)
  }

  return Array.from(map.entries())
    .map(([state, d]) => ({
      state,
      orders: d.orders,
      revenue: Math.round(d.revenue * 100) / 100,
      shipments: d.shipments,
      rtoCount: d.rtoCount,
      rtoPercent: d.shipments > 0 ? Math.round((d.rtoCount / d.shipments) * 10000) / 100 : null,
      codPercent: d.shipments > 0 ? Math.round((d.codCount / d.shipments) * 10000) / 100 : null,
      deliveredPercent: d.shipments > 0 ? Math.round((d.deliveredCount / d.shipments) * 10000) / 100 : null,
      avgScore: d.pincodeCount > 0 ? Math.round((d.scoreSum / d.pincodeCount) * 10) / 10 : 0,
      pincodeCount: d.pincodeCount,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

function buildTierSummary(rows: PincodeIntelligenceRow[]) {
  const tiers: Record<string, { revenue: number; shipments: number; rtoCount: number; codCount: number; deliveredCount: number; orders: number }> = {
    T1: { revenue: 0, shipments: 0, rtoCount: 0, codCount: 0, deliveredCount: 0, orders: 0 },
    T2: { revenue: 0, shipments: 0, rtoCount: 0, codCount: 0, deliveredCount: 0, orders: 0 },
    T3: { revenue: 0, shipments: 0, rtoCount: 0, codCount: 0, deliveredCount: 0, orders: 0 },
  }
  for (const r of rows) {
    const key = r.tier === 1 ? 'T1' : r.tier === 2 ? 'T2' : 'T3'
    tiers[key].revenue += r.revenue
    tiers[key].shipments += r.shipmentCount
    tiers[key].rtoCount += r.rtoCount
    tiers[key].codCount += r.codCount
    tiers[key].deliveredCount += r.deliveredCount
    tiers[key].orders += r.orders
  }
  return Object.entries(tiers).map(([tier, d]) => ({
    tier,
    revenue: Math.round(d.revenue * 100) / 100,
    orders: d.orders,
    shipments: d.shipments,
    rtoPercent: d.shipments > 0 ? Math.round((d.rtoCount / d.shipments) * 10000) / 100 : null,
    codPercent: d.shipments > 0 ? Math.round((d.codCount / d.shipments) * 10000) / 100 : null,
    deliveredPercent: d.shipments > 0 ? Math.round((d.deliveredCount / d.shipments) * 10000) / 100 : null,
  }))
}

function buildSummaryFromRows(rows: PincodeIntelligenceRow[], totalShipments: number): Record<string, number | null> {
  if (rows.length === 0) return {}

  let totalRevenue = 0
  let totalOrders = 0
  let totalRto = 0
  let totalCod = 0
  let totalDelivered = 0
  let totalShipmentsInRows = 0
  let scoreSum = 0
  let highRtoPincodes = 0
  let highCodPincodes = 0
  let tier1Revenue = 0, tier2Revenue = 0, tier3Revenue = 0

  for (const r of rows) {
    totalRevenue += r.revenue
    totalOrders += r.orders
    totalRto += r.rtoCount
    totalCod += r.codCount
    totalDelivered += r.deliveredCount
    totalShipmentsInRows += r.shipmentCount
    scoreSum += r.profitabilityScore
    if ((r.rtoPercent ?? 0) >= 20) highRtoPincodes++
    if ((r.codPercent ?? 0) >= 50) highCodPincodes++
    if (r.tier === 1) tier1Revenue += r.revenue
    else if (r.tier === 2) tier2Revenue += r.revenue
    else tier3Revenue += r.revenue
  }

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalOrders,
    totalShipments,
    totalPincodes: rows.length,
    avgRtoPercent: totalShipmentsInRows > 0 ? Math.round((totalRto / totalShipmentsInRows) * 10000) / 100 : null,
    avgCodPercent: totalShipmentsInRows > 0 ? Math.round((totalCod / totalShipmentsInRows) * 10000) / 100 : null,
    avgDeliveredPercent: totalShipmentsInRows > 0 ? Math.round((totalDelivered / totalShipmentsInRows) * 10000) / 100 : null,
    avgScore: rows.length > 0 ? Math.round((scoreSum / rows.length) * 10) / 10 : null,
    highRtoPincodes,
    highCodPincodes,
    tier1Revenue: Math.round(tier1Revenue * 100) / 100,
    tier2Revenue: Math.round(tier2Revenue * 100) / 100,
    tier3Revenue: Math.round(tier3Revenue * 100) / 100,
  }
}

async function getDailyShipmentCounts(
  prisma: PrismaClient,
  shiprocketConnectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<CompressedDailyRow[]> {
  const dateWhere = buildShiprocketDateRangeWhere(fromDate, toDate)
  const shipments = await prisma.shiprocketShipment.findMany({
    where: { connectionId: shiprocketConnectionId, ...dateWhere },
    select: { shippedAt: true, shiprocketCreatedAt: true, syncedAt: true, status: true },
  })

  const dailyMap = new Map<string, { shipments: number; rto: number }>()
  for (const s of shipments) {
    const effectiveDate = getEffectiveShipmentDate(s)
    if (!effectiveDate) continue
    const dateStr = effectiveDate.toISOString().slice(0, 10)
    const isRto = (s.status ?? '').toUpperCase().includes('RTO')
    const entry = dailyMap.get(dateStr) ?? { shipments: 0, rto: 0 }
    entry.shipments++
    if (isRto) entry.rto++
    dailyMap.set(dateStr, entry)
  }

  return Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, d]) => ({
      date,
      shipments: d.shipments,
      rtoCount: d.rto,
      rtoRate: d.shipments > 0 ? Math.round((d.rto / d.shipments) * 10000) / 100 : 0,
    }))
}

export async function buildPincodeIntelligenceContext(
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
      skipped_shopify_order_tags: true,
      skip_zero_sales_orders: true,
      shiprocketConnection: { select: { id: true, status: true } },
      shopifyConnections: { select: { id: true }, take: 1 },
    },
  })

  const empty: PageContext = {
    page: 'pincode-intelligence',
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
  const orderInclusionWhere = getOrderInclusionWhere({
    skippedShopifyOrderTags: workspace.skipped_shopify_order_tags ?? [],
    skipZeroSalesOrders: workspace.skip_zero_sales_orders ?? false,
  })

  const baseParams = {
    shiprocketConnectionId: srConn.id,
    shopifyConnectionId,
    orderInclusionWhere,
    sort: 'orders',
    order: 'desc' as const,
  }

  const [currentResult, priorResult, daily] = await Promise.all([
    getPincodeIntelligence(prisma, { fromDate: dateFrom, toDate: dateTo, ...baseParams }),
    getPincodeIntelligence(prisma, { fromDate: priorRange.from, toDate: priorRange.to, ...baseParams }),
    getDailyShipmentCounts(prisma, srConn.id, dateFrom, dateTo),
  ])

  const currentRows = currentResult.rows
  const priorRows = priorResult.rows

  const summary = buildSummaryFromRows(currentRows, currentResult.totalShipments)
  const priorSummary = buildSummaryFromRows(priorRows, priorResult.totalShipments)

  // State-level aggregation
  const stateSummaries = buildStateSummaries(currentRows)
  const tierSummaries = buildTierSummary(currentRows)

  // COD Kill List: high COD + high RTO (min 3 shipments)
  const codKillList = currentRows
    .filter((r) => r.shipmentCount >= 3 && (r.rtoPercent ?? 0) >= 20 && (r.codPercent ?? 0) >= 40)
    .sort((a, b) => (b.rtoPercent ?? 0) - (a.rtoPercent ?? 0))
    .slice(0, 10)
    .map(compressRow)

  // Top revenue pincodes
  const topRevenuePincodes = currentRows
    .slice(0, 10)
    .map(compressRow)

  // RTO hotspots (min 5 shipments, rto > 20%)
  const rtoHotspots = currentRows
    .filter((r) => r.shipmentCount >= 5 && (r.rtoPercent ?? 0) >= 20)
    .sort((a, b) => (b.rtoPercent ?? 0) - (a.rtoPercent ?? 0))
    .slice(0, 8)
    .map(compressRow)

  // Loyalty gems: high repeat rate, min 5 orders
  const loyaltyGems = currentRows
    .filter((r) => r.orders >= 5 && (r.repeatRate ?? 0) > 0)
    .sort((a, b) => (b.repeatRate ?? 0) - (a.repeatRate ?? 0))
    .slice(0, 6)
    .map(compressRow)

  // Expansion opportunities: T3 pincodes with high score (min 3 orders)
  const expansionOpps = currentRows
    .filter((r) => r.tier === 3 && r.orders >= 3 && r.profitabilityScore >= 65)
    .sort((a, b) => b.profitabilityScore - a.profitabilityScore)
    .slice(0, 6)
    .map(compressRow)

  // Problem areas: score < 35, min 3 shipments
  const problemAreas = currentRows
    .filter((r) => r.shipmentCount >= 3 && r.profitabilityScore < 35)
    .sort((a, b) => a.profitabilityScore - b.profitabilityScore)
    .slice(0, 6)
    .map(compressRow)

  return {
    page: 'pincode-intelligence',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary,
    priorSummary,
    daily,
    currency: 'INR',
    extra: {
      stateSummaries: stateSummaries.slice(0, 10),
      tierSummaries,
      codKillList,
      topRevenuePincodes,
      rtoHotspots,
      loyaltyGems,
      expansionOpps,
      problemAreas,
      totalPincodes: currentResult.rows.length,
    },
  }
}
