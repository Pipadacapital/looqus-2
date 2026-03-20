/**
 * Acquisition page: New Customer Contribution Margin 2 and related metrics.
 * Uses app-wide CM2 logic (revenue - COGS - variable costs - ad spend, with refunds allocated to order date).
 * New customer = first order in selected period (`fetchCustomerFirstOrdersInRange` — Cohorts / LTV / Products / Timings).
 */

import type { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { eachDayOfInterval, subDays } from 'date-fns'
import {
  computeMarketingEfficiency,
  fetchAdSpendMapsWithClassification,
  fetchCustomerFirstOrdersInRange,
  fetchStoreNetRevenueForPeriod,
  getOrderInclusionWhere,
  normalizeOrderFilterSettings,
  sumDailyMapInRange,
  type MarketingEfficiencySnapshot,
} from '@/lib/metrics'
import { buildShiprocketDateRangeWhere } from '@/lib/shiprocket-list'
import { RTO_STATUS_CODES } from '@/lib/workspace-metrics/constants'
import { getEffectiveDailyAggregates } from '@/lib/effective-daily'
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

async function getDailyRates(
  prisma: PrismaClient,
  workspaceId: string,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  orderInclusionWhere?: Prisma.ShopifyOrderWhereInput
): Promise<Map<string, { ordersCount: number; grossSales: number; shipping: number; packaging: number; website: number }>> {
  const effective = await getEffectiveDailyAggregates(
    prisma,
    connectionId,
    fromDate,
    toDate,
    orderInclusionWhere
  )
  const workspaceCosts = await prisma.workspaceCost.findMany({
    where: { workspaceId, effectiveFrom: { lte: toDate } },
  })
  const map = new Map<string, { ordersCount: number; grossSales: number; shipping: number; packaging: number; website: number }>()
  for (const [dateStr, d] of effective) {
    const ordersCount = d.ordersCount
    const grossSales = d.grossSales
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

async function getDailyReturnsAndSales(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  orderInclusionWhere?: Prisma.ShopifyOrderWhereInput
): Promise<Map<string, { grossSales: number; totalReturns: number }>> {
  const effective = await getEffectiveDailyAggregates(
    prisma,
    connectionId,
    fromDate,
    toDate,
    orderInclusionWhere
  )
  const map = new Map<string, { grossSales: number; totalReturns: number }>()
  for (const [dateStr, d] of effective) {
    map.set(dateStr, { grossSales: d.grossSales, totalReturns: d.totalReturns })
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

async function getRtoOrderIds(
  prisma: PrismaClient,
  workspaceId: string,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  orderInclusionWhere: Prisma.ShopifyOrderWhereInput
): Promise<Set<string>> {
  const sr = await prisma.shiprocketConnection.findUnique({
    where: { workspaceId },
    select: { id: true, status: true },
  })
  if (!sr || sr.status !== 'CONNECTED') return new Set()
  const dateWhere = buildShiprocketDateRangeWhere(fromDate, toDate)
  const shipments = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId: sr.id,
      ...dateWhere,
      OR: [
        { trackingStatusCode: { in: [...RTO_STATUS_CODES] } },
        { statusCode: { in: [...RTO_STATUS_CODES] } },
      ],
    },
    select: { channelOrderId: true },
  })
  const channelIds = shipments
    .map((s) => s.channelOrderId)
    .filter((id): id is string => id != null && id !== '')
  if (channelIds.length === 0) return new Set()
  const cleanIds = channelIds.map((id) => id.replace(/^#/, ''))
  const matched = await prisma.shopifyOrder.findMany({
    where: {
      connectionId,
      OR: [
        { orderNumber: { in: cleanIds } },
        { name: { in: channelIds } },
      ],
      ...orderInclusionWhere,
    },
    select: { orderNumber: true, name: true },
  })
  const ids = new Set<string>()
  for (const o of matched) {
    if (o.orderNumber) ids.add(o.orderNumber)
    if (o.name) {
      ids.add(o.name)
      ids.add(o.name.replace(/^#/, ''))
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
  /** MER / aMER / ACOS; aMER uses acquisition-classified spend only. */
  marketingEfficiency: MarketingEfficiencySnapshot
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
  /** Acquisition-classified ad spend (for aMER denominator). */
  acquisitionAdSpend: number
  /** New-customer revenue ÷ acquisition ad spend when spend > 0. */
  aMerDaily: number | null
  ncRevenue: number
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
        marketingEfficiency: computeMarketingEfficiency({
          storeNetRevenue: 0,
          totalAdSpend: 0,
          newCustomerRevenue: 0,
          acquisitionAdSpend: 0,
        }),
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

  const [firstOrders, dailyRates, adSpendMaps, dailyReturnsAndSales, rtoIds, storeNetRevenue] =
    await Promise.all([
      fetchCustomerFirstOrdersInRange(prisma, connectionId, fromDate, toDate, orderFilterSettings),
      getDailyRates(prisma, workspace.id, connectionId, fromDate, toDateExtended, orderInclusionWhere),
      fetchAdSpendMapsWithClassification(
        prisma,
        workspace.id,
        workspace,
        fromDate,
        toDateExtended
      ),
      getDailyReturnsAndSales(prisma, connectionId, fromDate, toDateExtended, orderInclusionWhere),
      getRtoOrderIds(prisma, workspace.id, connectionId, fromDate, toDateExtended, orderInclusionWhere),
      fetchStoreNetRevenueForPeriod(
        prisma,
        connectionId,
        fromDate,
        toDate,
        orderFilterSettings
      ),
    ])

  const { byDate: dailyAdSpend, metaByDate, googleByDate, acquisitionByDate } = adSpendMaps
  const fromStr = params.from
  const toStr = params.to

  if (firstOrders.length === 0) {
    const daily: AcquisitionDailyRow[] = []
    const allDays = new Set<string>()
    for (const [d] of dailyAdSpend) allDays.add(d)
    for (const [d] of dailyRates) allDays.add(d)
    const sortedDays = [...allDays].sort()
    const totalMeta = [...metaByDate.values()].reduce((a, b) => a + b, 0)
    const totalGoogle = [...googleByDate.values()].reduce((a, b) => a + b, 0)
    const totalAdSpendEmpty = totalMeta + totalGoogle
    for (const dateStr of sortedDays) {
      const adSpend = dailyAdSpend.get(dateStr) ?? 0
      const acq = acquisitionByDate.get(dateStr) ?? 0
      daily.push({
        date: dateStr,
        ncCm2: 0,
        adSpend,
        cm2PerNc: 0,
        blendedCac: 0,
        newCustomers: 0,
        meta: metaByDate.get(dateStr) ?? 0,
        google: googleByDate.get(dateStr) ?? 0,
        acquisitionAdSpend: acq,
        aMerDaily: acq > 0 ? 0 : null,
        ncRevenue: 0,
      })
    }
    return {
      summary: {
        cm2: 0,
        newCustomers: 0,
        cm2PerNc: 0,
        meta: totalMeta,
        google: totalGoogle,
        totalAdSpend: totalAdSpendEmpty,
        blendedCac: 0,
        marketingEfficiency: computeMarketingEfficiency({
          storeNetRevenue,
          totalAdSpend: sumDailyMapInRange(dailyAdSpend, fromStr, toStr),
          newCustomerRevenue: 0,
          acquisitionAdSpend: sumDailyMapInRange(acquisitionByDate, fromStr, toStr),
        }),
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
      totalTax: true,
      orderNumber: true,
      name: true,
    },
  })

  const orderCogsMap = await getOrderCogs(prisma, connectionId, orders.map((o) => o.id), workspace.cogsSettings ?? null)

  let totalNcCm2 = 0
  let newCustomerRevenue = 0
  const byDay: Map<
    string,
    {
      ncCm2: number
      newCustomers: number
      adSpend: number
      meta: number
      google: number
      ncRevenue: number
    }
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
    const totalTax = Number(order.totalTax ?? 0)
    if (!isRto) {
      newCustomerRevenue += totalPrice - totalTax - orderShareRefunds
    }

    totalNcCm2 += ncCm2Order

    const cur = byDay.get(dateStr) ?? {
      ncCm2: 0,
      newCustomers: 0,
      adSpend: 0,
      meta: 0,
      google: 0,
      ncRevenue: 0,
    }
    cur.ncCm2 += ncCm2Order
    cur.newCustomers += 1
    cur.adSpend = dailyAdSpend.get(dateStr) ?? 0
    cur.meta = metaByDate.get(dateStr) ?? 0
    cur.google = googleByDate.get(dateStr) ?? 0
    if (!isRto) cur.ncRevenue += totalPrice - totalTax - orderShareRefunds
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
    marketingEfficiency: computeMarketingEfficiency({
      storeNetRevenue,
      totalAdSpend: sumDailyMapInRange(dailyAdSpend, fromStr, toStr),
      newCustomerRevenue,
      acquisitionAdSpend: sumDailyMapInRange(acquisitionByDate, fromStr, toStr),
    }),
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
    const acqSpend = acquisitionByDate.get(dateStr) ?? 0
    const ncRev = day?.ncRevenue ?? 0
    return {
      date: dateStr,
      ncCm2,
      adSpend,
      cm2PerNc: nc > 0 ? ncCm2 / nc : 0,
      blendedCac: nc > 0 ? adSpend / nc : 0,
      newCustomers: nc,
      meta: day?.meta ?? metaByDate.get(dateStr) ?? 0,
      google: day?.google ?? googleByDate.get(dateStr) ?? 0,
      acquisitionAdSpend: acqSpend,
      aMerDaily: acqSpend > 0 ? ncRev / acqSpend : null,
      ncRevenue: ncRev,
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
  const firstOrders = await fetchCustomerFirstOrdersInRange(
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
    fetchCustomerFirstOrdersInRange(prisma, connectionId, fromExtended, toDate, orderFilterSettings),
    getDailyRates(prisma, workspace.id, connectionId, fromExtended, toDateExtended, orderInclusionWhere),
    fetchAdSpendMapsWithClassification(
      prisma,
      workspace.id,
      workspace,
      fromExtended,
      toDateExtended
    ),
    getDailyReturnsAndSales(prisma, connectionId, fromExtended, toDateExtended, orderInclusionWhere),
    getRtoOrderIds(prisma, workspace.id, connectionId, fromExtended, toDateExtended, orderInclusionWhere),
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

  type PctKey = 'discountsPct' | 'cm2Pct' | 'adSpendPct' | 'cogsPct' | 'variableCostsPct' | 'refundsPct'
  function getMa7(key: PctKey): (dateStr: string) => number {
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
          sum += row[key]
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
