/**
 * Acquisition page: New Customer Contribution Margin 2 and related metrics.
 * Uses app-wide CM2 logic (revenue - COGS - variable costs - ad spend, with refunds allocated to order date).
 * New customer = first order in selected period (same first-order logic as Cohorts / LTV).
 */

import type { PrismaClient } from '@prisma/client'
import { eachDayOfInterval, subDays } from 'date-fns'
import {
  getOrderInclusionWhere,
  hasNoOrderFilters,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import { resolveLineItemCogs, normalizeCogsSettings } from '@/lib/cogs'
import { getDailyVariableContribution } from '@/lib/workspace-costs'

const storeCurrency = 'INR'

export type WorkspaceForAcquisition = {
  id: string
  shopifyConnections: { id: string }[]
  cogsSettings?: {
    overrideAllCogsPercent: unknown
    fallbackCogsPercent: unknown
    cogsMarkupPercent: unknown
  } | null
  meta_ads_connections: {
    id: string
    selected_ad_account_ids: string[] | null
    selected_ad_account_id: string | null
  } | null
  google_ads_connections: {
    id: string
    selected_customer_ids: string[] | null
    selected_customer_id: string | null
  } | null
  skippedShopifyOrderTags?: string[] | null
  skipZeroSalesOrders?: boolean | null
}

type FirstOrderRow = { customer_shopify_id: string; first_at: Date; order_id: string }

async function getFirstOrdersInRange(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  orderFilterSettings?: { skippedShopifyOrderTags: string[]; skipZeroSalesOrders: boolean }
): Promise<FirstOrderRow[]> {
  if (orderFilterSettings && !hasNoOrderFilters(orderFilterSettings)) {
    const inclusionWhere = getOrderInclusionWhere(orderFilterSettings)
    const orders = await prisma.shopifyOrder.findMany({
      where: {
        connectionId,
        customerShopifyId: { not: null, notIn: [''] },
        processedAt: { lte: toDate },
        ...inclusionWhere,
      },
      select: { id: true, customerShopifyId: true, processedAt: true },
    })
    const firstByCustomer = new Map<string, { firstAt: Date; orderId: string }>()
    for (const o of orders) {
      const cid = o.customerShopifyId
      if (!cid) continue
      const existing = firstByCustomer.get(cid)
      if (!existing || o.processedAt < existing.firstAt) {
        firstByCustomer.set(cid, { firstAt: o.processedAt, orderId: o.id })
      }
    }
    return [...firstByCustomer.entries()]
      .filter(([, v]) => v.firstAt >= fromDate && v.firstAt <= toDate)
      .map(([customer_shopify_id, v]) => ({
        customer_shopify_id,
        first_at: v.firstAt,
        order_id: v.orderId,
      }))
  }
  const rows = await prisma.$queryRaw<FirstOrderRow[]>`
    WITH first_orders AS (
      SELECT customer_shopify_id, MIN(processed_at) AS first_at
      FROM shopify_orders
      WHERE connection_id = ${connectionId}::uuid
        AND customer_shopify_id IS NOT NULL
        AND customer_shopify_id != ''
      GROUP BY customer_shopify_id
    )
    SELECT fo.customer_shopify_id, fo.first_at, o.id AS order_id
    FROM first_orders fo
    JOIN shopify_orders o ON o.customer_shopify_id = fo.customer_shopify_id
      AND o.processed_at = fo.first_at
      AND o.connection_id = ${connectionId}::uuid
    WHERE fo.first_at >= ${fromDate}
      AND fo.first_at <= ${toDate}
  `
  return rows
}

async function getDailyRates(
  prisma: PrismaClient,
  workspaceId: string,
  connectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<Map<string, { ordersCount: number; grossSales: number; shipping: number; packaging: number; website: number }>> {
  const daily = await prisma.shopifyAnalyticsDaily.findMany({
    where: { connectionId, date: { gte: fromDate, lte: toDate } },
    select: { date: true, ordersCount: true, grossSales: true },
  })
  const workspaceCosts = await prisma.workspaceCost.findMany({
    where: { workspaceId, effectiveFrom: { lte: toDate } },
  })
  const map = new Map<string, { ordersCount: number; grossSales: number; shipping: number; packaging: number; website: number }>()
  for (const d of daily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    const ordersCount = d.ordersCount
    const grossSales = Number(d.grossSales)
    let shipping = 0,
      packaging = 0,
      website = 0
    for (const cost of workspaceCosts) {
      const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
      const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
      if (dateStr < costFromStr || dateStr > costToStr) continue
      const contribution = getDailyVariableContribution(
        {
          costType: cost.costType,
          amount: Number(cost.amount),
          currency: cost.currency,
          isPercent: cost.isPercent,
          billingMode: cost.billingMode ?? 'monthly',
        },
        dateStr,
        ordersCount,
        grossSales,
        storeCurrency
      )
      if (cost.costType === 'SHIPPING') shipping += contribution
      else if (cost.costType === 'PACKAGING') packaging += contribution
      else if (cost.costType === 'WEBSITE') website += contribution
    }
    map.set(dateStr, { ordersCount, grossSales, shipping, packaging, website })
  }
  return map
}

async function getDailyAdSpend(
  prisma: PrismaClient,
  workspace: WorkspaceForAcquisition,
  fromDate: Date,
  toDate: Date
): Promise<{
  byDate: Map<string, number>
  metaByDate: Map<string, number>
  googleByDate: Map<string, number>
}> {
  const byDate = new Map<string, number>()
  const metaByDate = new Map<string, number>()
  const googleByDate = new Map<string, number>()
  const meta = workspace.meta_ads_connections
  const google = workspace.google_ads_connections
  const metaIds = meta?.selected_ad_account_ids?.length ? meta.selected_ad_account_ids : meta?.selected_ad_account_id ? [meta.selected_ad_account_id] : undefined
  const googleIds = google?.selected_customer_ids?.length ? google.selected_customer_ids : google?.selected_customer_id ? [google.selected_customer_id] : undefined

  if (meta?.id) {
    const metaWhere: { connection_id: string; date: { gte: Date; lte: Date }; ad_account_id?: { in: string[] } } = {
      connection_id: meta.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (metaIds?.length) metaWhere.ad_account_id = { in: metaIds }
    const rows = await prisma.meta_ads_daily_metrics.groupBy({
      by: ['date'],
      where: metaWhere as Parameters<typeof prisma.meta_ads_daily_metrics.groupBy>[0]['where'],
      _sum: { spend: true },
    })
    for (const r of rows) {
      const dateStr = r.date.toISOString().slice(0, 10)
      const spend = Number(r._sum.spend ?? 0)
      metaByDate.set(dateStr, (metaByDate.get(dateStr) ?? 0) + spend)
      byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + spend)
    }
  }
  if (google?.id) {
    const googleWhere: { connection_id: string; date: { gte: Date; lte: Date }; customer_id?: { in: string[] } } = {
      connection_id: google.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (googleIds?.length) googleWhere.customer_id = { in: googleIds }
    const rows = await prisma.google_ads_daily_metrics.groupBy({
      by: ['date'],
      where: googleWhere as Parameters<typeof prisma.google_ads_daily_metrics.groupBy>[0]['where'],
      _sum: { spend: true },
    })
    for (const r of rows) {
      const dateStr = r.date.toISOString().slice(0, 10)
      const spend = Number(r._sum.spend ?? 0)
      googleByDate.set(dateStr, (googleByDate.get(dateStr) ?? 0) + spend)
      byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + spend)
    }
  }
  return { byDate, metaByDate, googleByDate }
}

async function getDailyReturnsAndSales(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<Map<string, { grossSales: number; totalReturns: number }>> {
  const rows = await prisma.shopifyAnalyticsDaily.findMany({
    where: { connectionId, date: { gte: fromDate, lte: toDate } },
    select: { date: true, grossSales: true, total_returns: true },
  })
  const map = new Map<string, { grossSales: number; totalReturns: number }>()
  for (const r of rows) {
    const dateStr = r.date.toISOString().slice(0, 10)
    map.set(dateStr, {
      grossSales: Number(r.grossSales),
      totalReturns: Number(r.total_returns ?? 0),
    })
  }
  return map
}

async function getOrderCogs(
  prisma: PrismaClient,
  connectionId: string,
  orderIds: string[],
  rawCogsSettings: WorkspaceForAcquisition['cogsSettings']
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map()
  const [products, items] = await Promise.all([
    prisma.shopifyProduct.findMany({
      where: { connectionId },
      select: { shopifyId: true, coq: true },
    }),
    prisma.shopifyLineItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, productShopifyId: true, quantity: true, price: true },
    }),
  ])
  const coqMap = new Map(products.filter((p) => p.coq).map((p) => [p.shopifyId, Number(p.coq)]))
  const settings = normalizeCogsSettings(rawCogsSettings ?? null)
  const cogsByOrder = new Map<string, number>()
  for (const it of items) {
    const cogs = resolveLineItemCogs(
      { price: Number(it.price), quantity: it.quantity, productShopifyId: it.productShopifyId },
      coqMap,
      settings
    )
    cogsByOrder.set(it.orderId, (cogsByOrder.get(it.orderId) ?? 0) + cogs)
  }
  return cogsByOrder
}

const RTO_CODES = [9, 10, 14, 20, 40, 41, 46]

async function getRtoOrderIds(
  prisma: PrismaClient,
  workspaceId: string,
  connectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<Set<string>> {
  const sr = await prisma.shiprocketConnection.findUnique({
    where: { workspaceId },
    select: { id: true, status: true },
  })
  if (!sr || sr.status !== 'CONNECTED') return new Set()
  const shipments = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId: sr.id,
      shippedAt: { gte: fromDate, lte: toDate },
      OR: [
        { trackingStatusCode: { in: RTO_CODES } },
        { statusCode: { in: RTO_CODES } },
      ],
    },
    select: { channelOrderId: true },
  })
  const ids = new Set<string>()
  for (const s of shipments) {
    if (s.channelOrderId && s.channelOrderId !== '') {
      ids.add(s.channelOrderId)
      ids.add(s.channelOrderId.replace(/^#/, ''))
    }
  }
  return ids
}

export type AcquisitionSummary = {
  cm2: number
  newCustomers: number
  cm2PerNc: number
  meta: number
  google: number
  totalAdSpend: number
  blendedCac: number
}

export type AcquisitionDailyRow = {
  date: string
  ncCm2: number
  adSpend: number
  cm2PerNc: number
  blendedCac: number
  newCustomers: number
  meta: number
  google: number
}

export async function computeAcquisition(
  prisma: PrismaClient,
  workspace: WorkspaceForAcquisition,
  params: { from: string; to: string }
): Promise<{ summary: AcquisitionSummary; daily: AcquisitionDailyRow[]; currency: string }> {
  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return {
      summary: {
        cm2: 0,
        newCustomers: 0,
        cm2PerNc: 0,
        meta: 0,
        google: 0,
        totalAdSpend: 0,
        blendedCac: 0,
      },
      daily: [],
      currency: storeCurrency,
    }
  }

  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const toDateExtended = new Date(toDate)
  toDateExtended.setUTCDate(toDateExtended.getUTCDate() + 1)

  const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)
  const orderInclusionWhere = getOrderInclusionWhere(orderFilterSettings)

  const [firstOrders, dailyRates, adSpendMaps, dailyReturnsAndSales, rtoIds] = await Promise.all([
    getFirstOrdersInRange(prisma, connectionId, fromDate, toDate, orderFilterSettings),
    getDailyRates(prisma, workspace.id, connectionId, fromDate, toDateExtended),
    getDailyAdSpend(prisma, workspace, fromDate, toDateExtended),
    getDailyReturnsAndSales(prisma, connectionId, fromDate, toDateExtended),
    getRtoOrderIds(prisma, workspace.id, connectionId, fromDate, toDateExtended),
  ])

  const { byDate: dailyAdSpend, metaByDate, googleByDate } = adSpendMaps

  if (firstOrders.length === 0) {
    const daily: AcquisitionDailyRow[] = []
    const allDays = new Set<string>()
    for (const [d] of dailyAdSpend) allDays.add(d)
    for (const [d] of dailyRates) allDays.add(d)
    const sortedDays = [...allDays].sort()
    for (const dateStr of sortedDays) {
      const adSpend = dailyAdSpend.get(dateStr) ?? 0
      daily.push({
        date: dateStr,
        ncCm2: 0,
        adSpend,
        cm2PerNc: 0,
        blendedCac: 0,
        newCustomers: 0,
        meta: metaByDate.get(dateStr) ?? 0,
        google: googleByDate.get(dateStr) ?? 0,
      })
    }
    return {
      summary: {
        cm2: 0,
        newCustomers: 0,
        cm2PerNc: 0,
        meta: [...metaByDate.values()].reduce((a, b) => a + b, 0),
        google: [...googleByDate.values()].reduce((a, b) => a + b, 0),
        totalAdSpend: [...dailyAdSpend.values()].reduce((a, b) => a + b, 0),
        blendedCac: 0,
      },
      daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
      currency: storeCurrency,
    }
  }

  const firstByCustomer = new Map<string, { firstAt: Date; orderId: string }>()
  for (const r of firstOrders) {
    firstByCustomer.set(r.customer_shopify_id, { firstAt: r.first_at, orderId: r.order_id })
  }

  const firstOrderIds = new Set(firstOrders.map((r) => r.order_id))
  const orders = await prisma.shopifyOrder.findMany({
    where: {
      connectionId,
      id: { in: [...firstOrderIds] },
      ...orderInclusionWhere,
    },
    select: {
      id: true,
      customerShopifyId: true,
      processedAt: true,
      totalPrice: true,
      orderNumber: true,
      name: true,
    },
  })

  const orderCogsMap = await getOrderCogs(prisma, connectionId, orders.map((o) => o.id), workspace.cogsSettings ?? null)

  let totalNcCm2 = 0
  const byDay: Map<
    string,
    { ncCm2: number; newCustomers: number; adSpend: number; meta: number; google: number }
  > = new Map()

  for (const order of orders) {
    const dateStr = order.processedAt.toISOString().slice(0, 10)
    const rates = dailyRates.get(dateStr)
    const ordersThatDay = rates?.ordersCount ?? 1
    const perOrderShipping = (rates?.shipping ?? 0) / ordersThatDay
    const perOrderPackaging = (rates?.packaging ?? 0) / ordersThatDay
    const perOrderWebsite = (rates?.website ?? 0) / ordersThatDay
    const perOrderAdSpend = (dailyAdSpend.get(dateStr) ?? 0) / ordersThatDay
    const cogs = orderCogsMap.get(order.id) ?? 0
    const totalPrice = Number(order.totalPrice)
    const cm2 = totalPrice - cogs - perOrderShipping - perOrderPackaging - perOrderWebsite - perOrderAdSpend
    const isRto = rtoIds.has(order.orderNumber) || rtoIds.has(order.name) || (order.name && rtoIds.has('#' + order.name))
    const daily = dailyReturnsAndSales.get(dateStr)
    const grossSales = daily?.grossSales ?? 0
    const totalReturns = daily?.totalReturns ?? 0
    const orderShareRefunds = grossSales > 0 ? (totalPrice / grossSales) * totalReturns : 0
    const ncCm2Order = isRto ? 0 : cm2 - orderShareRefunds

    totalNcCm2 += ncCm2Order

    const cur = byDay.get(dateStr) ?? { ncCm2: 0, newCustomers: 0, adSpend: 0, meta: 0, google: 0 }
    cur.ncCm2 += ncCm2Order
    cur.newCustomers += 1
    cur.adSpend = dailyAdSpend.get(dateStr) ?? 0
    cur.meta = metaByDate.get(dateStr) ?? 0
    cur.google = googleByDate.get(dateStr) ?? 0
    byDay.set(dateStr, cur)
  }

  const newCustomers = firstOrders.length
  const totalMeta = [...metaByDate.values()].reduce((a, b) => a + b, 0)
  const totalGoogle = [...googleByDate.values()].reduce((a, b) => a + b, 0)
  const totalAdSpend = totalMeta + totalGoogle
  const cm2PerNc = newCustomers > 0 ? totalNcCm2 / newCustomers : 0
  const blendedCac = newCustomers > 0 ? totalAdSpend / newCustomers : 0

  const summary: AcquisitionSummary = {
    cm2: totalNcCm2,
    newCustomers,
    cm2PerNc,
    meta: totalMeta,
    google: totalGoogle,
    totalAdSpend,
    blendedCac,
  }

  const allDays = new Set<string>()
  for (const [d] of byDay) allDays.add(d)
  for (const [d] of dailyAdSpend) allDays.add(d)
  const sortedDays = [...allDays].sort()
  const daily: AcquisitionDailyRow[] = sortedDays.map((dateStr) => {
    const day = byDay.get(dateStr)
    const adSpend = dailyAdSpend.get(dateStr) ?? 0
    const nc = day?.newCustomers ?? 0
    const ncCm2 = day?.ncCm2 ?? 0
    return {
      date: dateStr,
      ncCm2,
      adSpend,
      cm2PerNc: nc > 0 ? ncCm2 / nc : 0,
      blendedCac: nc > 0 ? adSpend / nc : 0,
      newCustomers: nc,
      meta: day?.meta ?? metaByDate.get(dateStr) ?? 0,
      google: day?.google ?? googleByDate.get(dateStr) ?? 0,
    }
  })

  return {
    summary,
    daily,
    currency: storeCurrency,
  }
}

export type AcquisitionTrendRow = {
  date: string
  ma90: number
  ma180: number
  ma365: number
}

/**
 * Daily new customer count = count of customers whose first-ever order date is that day.
 * Uses same first-order logic as Cohorts / LTV / Acquisition (workspace order filters applied).
 * 90/180/365-day MA = trailing moving average of daily new customer count; uses available days if fewer than full period.
 */
export async function computeAcquisitionTrend(
  prisma: PrismaClient,
  workspace: WorkspaceForAcquisition,
  params: { from: string; to: string }
): Promise<AcquisitionTrendRow[]> {
  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) return []

  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const fromExtended = subDays(fromDate, 364)

  const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)
  const firstOrders = await getFirstOrdersInRange(
    prisma,
    connectionId,
    fromExtended,
    toDate,
    orderFilterSettings
  )

  const dailyCount = new Map<string, number>()
  for (const r of firstOrders) {
    const dateStr = r.first_at.toISOString().slice(0, 10)
    dailyCount.set(dateStr, (dailyCount.get(dateStr) ?? 0) + 1)
  }

  const allDays = eachDayOfInterval({ start: fromExtended, end: toDate })
  const fromStr = params.from
  const toStr = params.to

  const getCount = (d: Date) => dailyCount.get(d.toISOString().slice(0, 10)) ?? 0

  const result: AcquisitionTrendRow[] = []
  for (const day of allDays) {
    const dateStr = day.toISOString().slice(0, 10)
    if (dateStr < fromStr || dateStr > toStr) continue

    const dayStart = new Date(dateStr + 'T00:00:00.000Z')
    const window90Start = subDays(dayStart, 89)
    const window180Start = subDays(dayStart, 179)
    const window365Start = subDays(dayStart, 364)

    const start90 = window90Start < fromExtended ? fromExtended : window90Start
    const start180 = window180Start < fromExtended ? fromExtended : window180Start
    const start365 = window365Start < fromExtended ? fromExtended : window365Start

    const days90 = eachDayOfInterval({ start: start90, end: dayStart })
    const days180 = eachDayOfInterval({ start: start180, end: dayStart })
    const days365 = eachDayOfInterval({ start: start365, end: dayStart })

    const sum90 = days90.reduce((s, d) => s + getCount(d), 0)
    const sum180 = days180.reduce((s, d) => s + getCount(d), 0)
    const sum365 = days365.reduce((s, d) => s + getCount(d), 0)

    const ma90 = days90.length > 0 ? sum90 / days90.length : 0
    const ma180 = days180.length > 0 ? sum180 / days180.length : 0
    const ma365 = days365.length > 0 ? sum365 / days365.length : 0

    result.push({ date: dateStr, ma90, ma180, ma365 })
  }

  return result.sort((a, b) => a.date.localeCompare(b.date))
}

export type AcquisitionCompositionSummary = {
  discountsPct: number
  cm2Pct: number
  adSpendPct: number
  cogsPct: number
  variableCostsPct: number
  refundsPct: number
}

export type AcquisitionCompositionDailyRow = {
  date: string
  ncContributionMarginPct: number
  adSpendPct: number
  cogsPct: number
  variableCostsPct: number
  refundsPct: number
  discountPct: number
}

/**
 * New Customer Order Composition: daily percentages (of gross sales or net revenue ex tax) for NC orders only,
 * then 7-day trailing average for chart. Summary = blended percentage over full range.
 */
export async function computeAcquisitionComposition(
  prisma: PrismaClient,
  workspace: WorkspaceForAcquisition,
  params: { from: string; to: string }
): Promise<{ summary: AcquisitionCompositionSummary; daily: AcquisitionCompositionDailyRow[] }> {
  const connectionId = workspace.shopifyConnections[0]?.id
  const emptySummary: AcquisitionCompositionSummary = {
    discountsPct: 0,
    cm2Pct: 0,
    adSpendPct: 0,
    cogsPct: 0,
    variableCostsPct: 0,
    refundsPct: 0,
  }
  if (!connectionId) return { summary: emptySummary, daily: [] }

  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const fromExtended = subDays(fromDate, 6)
  const toDateExtended = new Date(toDate)
  toDateExtended.setUTCDate(toDateExtended.getUTCDate() + 1)

  const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)
  const orderInclusionWhere = getOrderInclusionWhere(orderFilterSettings)

  const [firstOrders, dailyRates, adSpendMaps, dailyReturnsAndSales, rtoIds] = await Promise.all([
    getFirstOrdersInRange(prisma, connectionId, fromExtended, toDate, orderFilterSettings),
    getDailyRates(prisma, workspace.id, connectionId, fromExtended, toDateExtended),
    getDailyAdSpend(prisma, workspace, fromExtended, toDateExtended),
    getDailyReturnsAndSales(prisma, connectionId, fromExtended, toDateExtended),
    getRtoOrderIds(prisma, workspace.id, connectionId, fromExtended, toDateExtended),
  ])

  const dailyAdSpend = adSpendMaps.byDate

  if (firstOrders.length === 0) {
    const allDays = eachDayOfInterval({ start: fromDate, end: toDate })
    const daily: AcquisitionCompositionDailyRow[] = allDays.map((d) => ({
      date: d.toISOString().slice(0, 10),
      ncContributionMarginPct: 0,
      adSpendPct: 0,
      cogsPct: 0,
      variableCostsPct: 0,
      refundsPct: 0,
      discountPct: 0,
    }))
    return { summary: emptySummary, daily }
  }

  const firstOrderIds = new Set(firstOrders.map((r) => r.order_id))
  const orders = await prisma.shopifyOrder.findMany({
    where: {
      connectionId,
      id: { in: [...firstOrderIds] },
      ...orderInclusionWhere,
    },
    select: {
      id: true,
      processedAt: true,
      totalPrice: true,
      totalTax: true,
      totalDiscount: true,
      orderNumber: true,
      name: true,
    },
  })

  const orderCogsMap = await getOrderCogs(prisma, connectionId, orders.map((o) => o.id), workspace.cogsSettings ?? null)

  type DaySums = {
    grossSales: number
    discounts: number
    refunds: number
    netRevenueExTax: number
    cogs: number
    variableCosts: number
    adSpend: number
    cm2: number
  }
  const byDay = new Map<string, DaySums>()

  for (const order of orders) {
    const dateStr = order.processedAt.toISOString().slice(0, 10)
    const rates = dailyRates.get(dateStr)
    const ordersThatDay = rates?.ordersCount ?? 1
    const perOrderShipping = (rates?.shipping ?? 0) / ordersThatDay
    const perOrderPackaging = (rates?.packaging ?? 0) / ordersThatDay
    const perOrderWebsite = (rates?.website ?? 0) / ordersThatDay
    const perOrderAdSpend = (dailyAdSpend.get(dateStr) ?? 0) / ordersThatDay
    const cogs = orderCogsMap.get(order.id) ?? 0
    const totalPrice = Number(order.totalPrice)
    const totalTax = Number(order.totalTax ?? 0)
    const totalDiscount = Number(order.totalDiscount ?? 0)
    const discountsOrder = Math.abs(totalDiscount)
    const grossSalesOrder = totalPrice + discountsOrder

    const daily = dailyReturnsAndSales.get(dateStr)
    const dayGrossSales = daily?.grossSales ?? 0
    const totalReturns = daily?.totalReturns ?? 0
    const orderShareRefunds = dayGrossSales > 0 ? (totalPrice / dayGrossSales) * totalReturns : 0
    const netRevenueExTaxOrder = totalPrice - totalTax - orderShareRefunds

    const cm2Order = totalPrice - cogs - perOrderShipping - perOrderPackaging - perOrderWebsite - perOrderAdSpend
    const isRto = rtoIds.has(order.orderNumber) || rtoIds.has(order.name) || (order.name && rtoIds.has('#' + order.name))
    const ncCm2Order = isRto ? 0 : cm2Order - orderShareRefunds

    const variableOrder = perOrderShipping + perOrderPackaging + perOrderWebsite
    const adSpendOrder = perOrderAdSpend

    const cur = byDay.get(dateStr) ?? {
      grossSales: 0,
      discounts: 0,
      refunds: 0,
      netRevenueExTax: 0,
      cogs: 0,
      variableCosts: 0,
      adSpend: 0,
      cm2: 0,
    }
    cur.grossSales += grossSalesOrder
    cur.discounts += discountsOrder
    cur.refunds += orderShareRefunds
    cur.netRevenueExTax += netRevenueExTaxOrder
    cur.cogs += cogs
    cur.variableCosts += variableOrder
    cur.adSpend += adSpendOrder
    cur.cm2 += ncCm2Order
    byDay.set(dateStr, cur)
  }

  const allDays = eachDayOfInterval({ start: fromExtended, end: toDate })
  const fromStr = params.from
  const toStr = params.to

  const rawDaily: { date: string; discountsPct: number; cm2Pct: number; adSpendPct: number; cogsPct: number; variableCostsPct: number; refundsPct: number }[] = []
  for (const day of allDays) {
    const dateStr = day.toISOString().slice(0, 10)
    const s = byDay.get(dateStr) ?? {
      grossSales: 0,
      discounts: 0,
      refunds: 0,
      netRevenueExTax: 0,
      cogs: 0,
      variableCosts: 0,
      adSpend: 0,
      cm2: 0,
    }
    const discountsPct = s.grossSales !== 0 ? (s.discounts / s.grossSales) * 100 : 0
    const refundsPct = s.grossSales !== 0 ? (s.refunds / s.grossSales) * 100 : 0
    const denom = s.netRevenueExTax !== 0 ? s.netRevenueExTax : 1
    const cm2Pct = (s.cm2 / denom) * 100
    const adSpendPct = (s.adSpend / denom) * 100
    const cogsPct = (s.cogs / denom) * 100
    const variableCostsPct = (s.variableCosts / denom) * 100
    rawDaily.push({
      date: dateStr,
      discountsPct,
      cm2Pct,
      adSpendPct,
      cogsPct,
      variableCostsPct,
      refundsPct,
    })
  }

  const rawByDate = new Map(rawDaily.map((r) => [r.date, r]))

  function getMa7(key: keyof typeof rawDaily[0]): (dateStr: string) => number {
    return (dateStr: string) => {
      const d = new Date(dateStr + 'T00:00:00.000Z')
      const start = subDays(d, 6)
      let sum = 0
      let n = 0
      for (let i = 0; i < 7; i++) {
        const t = new Date(start)
        t.setUTCDate(t.getUTCDate() + i)
        const s = t.toISOString().slice(0, 10)
        const row = rawByDate.get(s)
        if (row) {
          sum += (row as unknown as Record<string, number>)[key]
          n++
        }
      }
      return n > 0 ? sum / n : 0
    }
  }

  const daily: AcquisitionCompositionDailyRow[] = []
  for (const day of allDays) {
    const dateStr = day.toISOString().slice(0, 10)
    if (dateStr < fromStr || dateStr > toStr) continue
    daily.push({
      date: dateStr,
      ncContributionMarginPct: getMa7('cm2Pct')(dateStr),
      adSpendPct: getMa7('adSpendPct')(dateStr),
      cogsPct: getMa7('cogsPct')(dateStr),
      variableCostsPct: getMa7('variableCostsPct')(dateStr),
      refundsPct: getMa7('refundsPct')(dateStr),
      discountPct: getMa7('discountsPct')(dateStr),
    })
  }

  let totalGrossSales = 0
  let totalDiscounts = 0
  let totalRefunds = 0
  let totalNetRevenueExTax = 0
  let totalCogs = 0
  let totalVariableCosts = 0
  let totalAdSpend = 0
  let totalCm2 = 0
  for (const day of allDays) {
    const dateStr = day.toISOString().slice(0, 10)
    if (dateStr < fromStr || dateStr > toStr) continue
    const s = byDay.get(dateStr) ?? { grossSales: 0, discounts: 0, refunds: 0, netRevenueExTax: 0, cogs: 0, variableCosts: 0, adSpend: 0, cm2: 0 }
    totalGrossSales += s.grossSales
    totalDiscounts += s.discounts
    totalRefunds += s.refunds
    totalNetRevenueExTax += s.netRevenueExTax
    totalCogs += s.cogs
    totalVariableCosts += s.variableCosts
    totalAdSpend += s.adSpend
    totalCm2 += s.cm2
  }

  const summary: AcquisitionCompositionSummary = {
    discountsPct: totalGrossSales !== 0 ? (totalDiscounts / totalGrossSales) * 100 : 0,
    refundsPct: totalGrossSales !== 0 ? (totalRefunds / totalGrossSales) * 100 : 0,
    cm2Pct: totalNetRevenueExTax !== 0 ? (totalCm2 / totalNetRevenueExTax) * 100 : 0,
    adSpendPct: totalNetRevenueExTax !== 0 ? (totalAdSpend / totalNetRevenueExTax) * 100 : 0,
    cogsPct: totalNetRevenueExTax !== 0 ? (totalCogs / totalNetRevenueExTax) * 100 : 0,
    variableCostsPct: totalNetRevenueExTax !== 0 ? (totalVariableCosts / totalNetRevenueExTax) * 100 : 0,
  }

  return { summary, daily: daily.sort((a, b) => a.date.localeCompare(b.date)) }
}
