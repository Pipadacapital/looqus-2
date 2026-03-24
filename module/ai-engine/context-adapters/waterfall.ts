import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { getDaysInMonth, differenceInDays } from 'date-fns'
import { computeLineItemsCogs, normalizeCogsSettings } from '@/lib/cogs'
import { getDailyVariableContribution } from '@/lib/workspace-costs'
import {
  getOrderInclusionWhereFromWorkspace,
  getFilteredDailyAggregates,
  hasNoOrderFilters,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import { getLogisticsSummary } from '@/lib/workspace-metrics/logistics-summary'
import type { PageContext, DateRange, CompressedDailyRow } from './types'

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1, INR: 83.5, EUR: 0.92, GBP: 0.79, AUD: 1.53, CAD: 1.35,
}
function convertCurrency(amount: number, from: string, to: string) {
  if (!from || !to || from === to) return amount
  return (amount / (EXCHANGE_RATES[from] || 1)) * (EXCHANGE_RATES[to] || 1)
}

function computePriorPeriod(from: Date, to: Date): DateRange {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

function getDateStringsInRange(fromDate: Date, toDate: Date): string[] {
  const out: string[] = []
  const cur = new Date(fromDate.getTime())
  cur.setUTCHours(0, 0, 0, 0)
  const end = new Date(toDate.getTime())
  end.setUTCHours(23, 59, 59, 999)
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

export type WaterfallNumbers = {
  grossSales: number
  discounts: number
  refunds: number
  tax: number
  shipping: number
  revenueAfterTaxShipping: number
  cogs: number
  variableCosts: number
  rtoCost: number
  cm1: number
  adSpend: number
  cm2: number
  fixedCost: number
  cm3: number
  founderSalary: number
  netProfit: number
  forwardCharges: number
  codCharges: number
  rtoCharges: number
  ordersCount: number
}

/**
 * Runs the full waterfall computation for a single period.
 * Mirrors the waterfall route.ts logic exactly, using the same lib/ functions.
 */
async function computeWaterfall(
  prisma: PrismaClient,
  workspace: any,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  customerFilter: 'all' | 'new' | 'returning' = 'all'
): Promise<WaterfallNumbers> {
  const storeCurrency = 'INR'
  const orderFilterSettings = normalizeOrderFilterSettings(workspace)
  const orderInclusionWhere = getOrderInclusionWhereFromWorkspace(workspace)
  const dateStrings = getDateStringsInRange(fromDate, toDate)

  const [
    dailyAnalytics,
    workspaceCosts,
    miscExpenses,
    products,
    lineItemsInRange,
    metaAdDaily,
    googleAdDaily,
    allOrdersInRange,
    filteredDaily,
  ] = await Promise.all([
    prisma.shopifyAnalyticsDaily.findMany({
      where: { connectionId, date: { gte: fromDate, lte: toDate } },
      orderBy: { date: 'asc' },
      select: {
        date: true, netSales: true, grossSales: true,
        totalTax: true, totalDiscount: true, ordersCount: true,
        currency: true, total_returns: true, returns: true,
      },
    }),
    prisma.workspaceCost.findMany({
      where: { workspaceId: workspace.id, effectiveFrom: { lte: toDate } },
    }),
    prisma.workspaceMiscExpense.findMany({
      where: { workspaceId: workspace.id, effectiveStartDate: { lte: toDate } },
    }),
    prisma.shopifyProduct.findMany({
      where: { connectionId },
      select: { shopifyId: true, coq: true },
    }),
    prisma.shopifyLineItem.findMany({
      where: {
        connectionId,
        order: {
          connectionId,
          processedAt: { gte: fromDate, lte: toDate },
          ...orderInclusionWhere,
        },
      },
      select: {
        productShopifyId: true,
        quantity: true,
        price: true,
        order: { select: { id: true, processedAt: true } },
      },
    }),
    workspace.meta_ads_connections?.id
      ? prisma.meta_ads_daily_metrics.findMany({
          where: {
            connection_id: workspace.meta_ads_connections.id,
            date: { gte: fromDate, lte: toDate },
            ...(workspace.meta_ads_connections.selected_ad_account_ids?.length
              ? { ad_account_id: { in: workspace.meta_ads_connections.selected_ad_account_ids } }
              : workspace.meta_ads_connections.selected_ad_account_id
                ? { ad_account_id: workspace.meta_ads_connections.selected_ad_account_id }
                : {}),
          },
          select: { date: true, spend: true },
        })
      : Promise.resolve([] as { date: Date; spend: any }[]),
    workspace.google_ads_connections?.id
      ? prisma.google_ads_daily_metrics.findMany({
          where: {
            connection_id: workspace.google_ads_connections.id,
            date: { gte: fromDate, lte: toDate },
            ...(workspace.google_ads_connections.selected_customer_ids?.length
              ? { customer_id: { in: workspace.google_ads_connections.selected_customer_ids } }
              : workspace.google_ads_connections.selected_customer_id
                ? { customer_id: workspace.google_ads_connections.selected_customer_id }
                : {}),
          },
          select: { date: true, spend: true },
        })
      : Promise.resolve([] as { date: Date; spend: any }[]),
    prisma.shopifyOrder.findMany({
      where: {
        connectionId,
        processedAt: { gte: fromDate, lte: toDate },
        ...orderInclusionWhere,
      },
      select: {
        id: true, customerShopifyId: true,
        processedAt: true, totalPrice: true,
        totalTax: true, totalDiscount: true,
      },
    }),
    hasNoOrderFilters(orderFilterSettings)
      ? Promise.resolve(new Map<string, { grossSales: number; ordersCount: number }>())
      : getFilteredDailyAggregates(prisma, connectionId, fromDate, toDate, orderFilterSettings),
  ])

  // Build effective daily (analytics + order fallback)
  const orderDerivedByDate = new Map<string, { grossSales: number; totalDiscount: number; totalTax: number; ordersCount: number }>()
  for (const o of allOrdersInRange) {
    const dateStr = o.processedAt.toISOString().slice(0, 10)
    const cur = orderDerivedByDate.get(dateStr) ?? { grossSales: 0, totalDiscount: 0, totalTax: 0, ordersCount: 0 }
    cur.grossSales += Number(o.totalPrice)
    cur.totalDiscount += Number(o.totalDiscount ?? 0)
    cur.totalTax += Number(o.totalTax)
    cur.ordersCount += 1
    orderDerivedByDate.set(dateStr, cur)
  }
  const analyticsDateSet = new Set(dailyAnalytics.map((d) => d.date.toISOString().slice(0, 10)))
  const orderOnlyDates = [...orderDerivedByDate.keys()].filter((d) => !analyticsDateSet.has(d))
  const orderDerivedRows = orderOnlyDates.map((dateStr) => {
    const v = orderDerivedByDate.get(dateStr)!
    return {
      date: new Date(`${dateStr}T00:00:00.000Z`),
      netSales: new Decimal(v.grossSales - Math.abs(v.totalDiscount)),
      grossSales: new Decimal(v.grossSales),
      totalTax: new Decimal(v.totalTax),
      totalDiscount: new Decimal(v.totalDiscount),
      ordersCount: v.ordersCount,
      currency: storeCurrency,
      total_returns: new Decimal(0),
      returns: new Decimal(0),
    }
  })
  const effectiveDaily = [...dailyAnalytics, ...orderDerivedRows].sort((a, b) => a.date.getTime() - b.date.getTime())

  // COGS
  const coqMap = new Map(products.filter((p) => p.coq).map((p) => [p.shopifyId, Number(p.coq)]))
  const cogsSettings = normalizeCogsSettings(workspace.cogsSettings)
  const lineItemsWithDate = lineItemsInRange.map((li) => ({
    price: Number(li.price), quantity: li.quantity,
    productShopifyId: li.productShopifyId, orderProcessedAt: li.order.processedAt,
  }))
  const { dailyCogs } = computeLineItemsCogs(lineItemsWithDate, coqMap, cogsSettings, {})

  // Daily ad spend map
  const dailyAdSpend = new Map<string, number>()
  for (const r of [...metaAdDaily, ...googleAdDaily]) {
    const d = r.date.toISOString().slice(0, 10)
    dailyAdSpend.set(d, (dailyAdSpend.get(d) ?? 0) + Number(r.spend))
  }

  // Founder salary allocation
  const founderMonthly = workspace.founder_salary_monthly != null ? Number(workspace.founder_salary_monthly) : 0
  const founderCurrency = workspace.founder_salary_currency ?? 'INR'
  const founderMonthlyConverted = convertCurrency(founderMonthly, founderCurrency, storeCurrency)
  let founderAllocated = 0
  {
    const cur = new Date(fromDate.getTime())
    cur.setUTCHours(0, 0, 0, 0)
    const end = new Date(toDate.getTime())
    end.setUTCHours(23, 59, 59, 999)
    while (cur <= end) {
      const daysInMonth = getDaysInMonth(cur)
      const monthStart = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1, 0, 0, 0, 0))
      const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0, 23, 59, 59, 999))
      const overlapStart = fromDate > monthStart ? fromDate : monthStart
      const overlapEnd = toDate < monthEnd ? toDate : monthEnd
      const overlapDays = overlapStart <= overlapEnd ? differenceInDays(overlapEnd, overlapStart) + 1 : 0
      founderAllocated += (founderMonthlyConverted / daysInMonth) * overlapDays
      cur.setUTCMonth(cur.getUTCMonth() + 1)
      cur.setUTCDate(1)
    }
  }

  // Aggregate totals
  let grossSales = 0, totalDiscount = 0, totalTax = 0, ordersCount = 0
  let cogs = 0, adSpend = 0, variableCosts = 0, fixedCosts = 0, totalReturns = 0

  for (const dateStr of dateStrings) {
    const filtered = filteredDaily.get(dateStr)
    const daily = effectiveDaily.find((d) => d.date.toISOString().slice(0, 10) === dateStr)
    const dayOrders = filtered ? filtered.ordersCount : daily?.ordersCount ?? 0
    const dayGross = filtered ? filtered.grossSales : daily ? Number(daily.grossSales) : 0

    if (filtered) { grossSales += filtered.grossSales; ordersCount += filtered.ordersCount }
    else if (daily) { grossSales += Number(daily.grossSales); ordersCount += daily.ordersCount }

    if (daily) {
      totalDiscount += Number(daily.totalDiscount)
      totalTax += Number(daily.totalTax)
      totalReturns += Number(daily.total_returns ?? 0)
    }
    cogs += dailyCogs.get(dateStr) ?? 0
    adSpend += dailyAdSpend.get(dateStr) ?? 0

    for (const cost of workspaceCosts) {
      const costFrom = cost.effectiveFrom.toISOString().slice(0, 10)
      const costTo = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
      if (dateStr >= costFrom && dateStr <= costTo) {
        variableCosts += getDailyVariableContribution(
          { costType: cost.costType, amount: Number(cost.amount), currency: cost.currency, isPercent: cost.isPercent, billingMode: cost.billingMode ?? 'monthly' },
          dateStr, dayOrders, dayGross, storeCurrency
        )
      }
    }

    const dayDate = new Date(dateStr + 'T12:00:00.000Z')
    const daysInMonth = getDaysInMonth(dayDate)
    for (const e of miscExpenses) {
      if (dateStr >= e.effectiveStartDate.toISOString().slice(0, 10)) {
        fixedCosts += convertCurrency(Number(e.amount), e.currency || 'INR', storeCurrency) / daysInMonth
      }
    }
  }

  // Shiprocket
  let forwardCharges = 0, codCharges = 0, rtoCharges = 0
  if (workspace.shiprocketConnection?.id && workspace.shiprocketConnection?.status === 'CONNECTED') {
    const logistics = await getLogisticsSummary(prisma, workspace.shiprocketConnection.id, fromDate, toDate)
    forwardCharges = logistics.forwardCharges
    codCharges = logistics.codCharges
    rtoCharges = logistics.rtoCharges
  }
  const shippingOutbound = forwardCharges + codCharges

  // Customer segmentation (new vs returning)
  let segGross = grossSales
  let segCogs = cogs
  let ratio = 1
  if (customerFilter !== 'all' && allOrdersInRange.length > 0) {
    const firstAtMap = new Map<string, Date>()
    for (const o of allOrdersInRange) {
      if (!o.customerShopifyId) continue
      const ex = firstAtMap.get(o.customerShopifyId)
      if (!ex || o.processedAt < ex) firstAtMap.set(o.customerShopifyId, o.processedAt)
    }
    segGross = 0
    for (const o of allOrdersInRange) {
      const firstAt = o.customerShopifyId ? firstAtMap.get(o.customerShopifyId) : null
      const isFirst = firstAt != null && o.processedAt.getTime() === firstAt.getTime()
      if (customerFilter === 'new' && isFirst) segGross += Number(o.totalPrice)
      else if (customerFilter === 'returning' && !isFirst) segGross += Number(o.totalPrice)
    }
    ratio = grossSales > 0 ? segGross / grossSales : 0
    segCogs = cogs * ratio
  }

  const ar = (v: number) => customerFilter === 'all' ? v : v * ratio
  const gs = customerFilter === 'all' ? grossSales : segGross
  const disc = ar(totalDiscount)
  const ref = ar(totalReturns)
  const tax = ar(totalTax)
  const ship = ar(shippingOutbound)
  const rto = ar(rtoCharges)
  const varC = ar(variableCosts)
  const adS = ar(adSpend)
  const fixed = ar(fixedCosts)
  const founder = ar(founderAllocated)
  const cogsVal = customerFilter === 'all' ? cogs : segCogs

  const revenueAfterTaxShipping = gs - Math.abs(disc) - Math.abs(ref) - Math.abs(tax) - ship
  const cm1 = revenueAfterTaxShipping - cogsVal - varC - rto
  const cm2 = cm1 - adS
  const cm3 = cm2 - fixed
  const netProfit = cm3 - founder

  return {
    grossSales: gs,
    discounts: Math.abs(disc),
    refunds: Math.abs(ref),
    tax: Math.abs(tax),
    shipping: ship,
    revenueAfterTaxShipping,
    cogs: cogsVal,
    variableCosts: varC,
    rtoCost: rto,
    cm1,
    adSpend: adS,
    cm2,
    fixedCost: fixed,
    cm3,
    founderSalary: founder,
    netProfit,
    forwardCharges,
    codCharges,
    rtoCharges,
    ordersCount,
  }
}

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

function toSummary(w: WaterfallNumbers): Record<string, number | null> {
  const gs = w.grossSales
  return {
    grossSales: Math.round(w.grossSales),
    discounts: Math.round(w.discounts),
    refunds: Math.round(w.refunds),
    tax: Math.round(w.tax),
    shipping: Math.round(w.shipping),
    revenueAfterTaxShipping: Math.round(w.revenueAfterTaxShipping),
    cogs: Math.round(w.cogs),
    variableCosts: Math.round(w.variableCosts),
    rtoCost: Math.round(w.rtoCost),
    cm1: Math.round(w.cm1),
    adSpend: Math.round(w.adSpend),
    cm2: Math.round(w.cm2),
    fixedCost: Math.round(w.fixedCost),
    cm3: Math.round(w.cm3),
    founderSalary: Math.round(w.founderSalary),
    netProfit: Math.round(w.netProfit),
    // % of gross sales — the real story
    discountPct: pct(w.discounts, gs),
    refundPct: pct(w.refunds, gs),
    taxPct: pct(w.tax, gs),
    shippingPct: pct(w.shipping, gs),
    cogsPct: pct(w.cogs, gs),
    variableCostsPct: pct(w.variableCosts, gs),
    rtoCostPct: pct(w.rtoCost, gs),
    adSpendPct: pct(w.adSpend, gs),
    fixedCostPct: pct(w.fixedCost, gs),
    founderSalaryPct: pct(w.founderSalary, gs),
    cm1Pct: pct(w.cm1, gs),
    cm2Pct: pct(w.cm2, gs),
    cm3Pct: pct(w.cm3, gs),
    netProfitPct: pct(w.netProfit, gs),
    ordersCount: w.ordersCount,
  }
}

/**
 * Builds waterfall context for AI insight generation.
 * Computes all scenarios: current all / prior all / current new / current returning.
 * Uses the same lib/ functions as the waterfall route — no duplication.
 */
export async function buildWaterfallContext(
  prisma: PrismaClient,
  workspaceId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<PageContext> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      shopifyConnections: { where: { status: 'CONNECTED' }, select: { id: true }, take: 1 },
      cogsSettings: true,
      meta_ads_connections: {
        select: { id: true, selected_ad_account_ids: true, selected_ad_account_id: true },
      },
      google_ads_connections: {
        select: { id: true, selected_customer_ids: true, selected_customer_id: true },
      },
      shiprocketConnection: { select: { id: true, status: true } },
    },
  })

  const connectionId = workspace.shopifyConnections[0]?.id
  const priorRange = computePriorPeriod(dateFrom, dateTo)

  const empty = (): PageContext => ({
    page: 'waterfall',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: {},
    priorSummary: {},
    daily: [],
    currency: 'INR',
  })

  if (!connectionId) return empty()

  const ws = workspace as any

  // Run all 4 scenarios in parallel
  const [current, prior, newCust, returning] = await Promise.all([
    computeWaterfall(prisma, ws, connectionId, dateFrom, dateTo, 'all'),
    computeWaterfall(prisma, ws, connectionId, priorRange.from, priorRange.to, 'all'),
    computeWaterfall(prisma, ws, connectionId, dateFrom, dateTo, 'new'),
    computeWaterfall(prisma, ws, connectionId, dateFrom, dateTo, 'returning'),
  ])

  const summary = toSummary(current)
  const priorSummary = toSummary(prior)

  // Daily rows = waterfall steps as rows for anomaly detection
  // Each row represents a cost line — value is % of gross sales (the signal)
  const steps: CompressedDailyRow[] = [
    { date: 'discounts',     value: current.discounts,     pctOfGross: pct(current.discounts, current.grossSales) },
    { date: 'refunds',       value: current.refunds,       pctOfGross: pct(current.refunds, current.grossSales) },
    { date: 'tax',           value: current.tax,           pctOfGross: pct(current.tax, current.grossSales) },
    { date: 'shipping',      value: current.shipping,      pctOfGross: pct(current.shipping, current.grossSales) },
    { date: 'cogs',          value: current.cogs,          pctOfGross: pct(current.cogs, current.grossSales) },
    { date: 'variableCosts', value: current.variableCosts, pctOfGross: pct(current.variableCosts, current.grossSales) },
    { date: 'rtoCost',       value: current.rtoCost,       pctOfGross: pct(current.rtoCost, current.grossSales) },
    { date: 'adSpend',       value: current.adSpend,       pctOfGross: pct(current.adSpend, current.grossSales) },
    { date: 'fixedCost',     value: current.fixedCost,     pctOfGross: pct(current.fixedCost, current.grossSales) },
    { date: 'founderSalary', value: current.founderSalary, pctOfGross: pct(current.founderSalary, current.grossSales) },
    { date: 'cm1',           value: current.cm1,           pctOfGross: pct(current.cm1, current.grossSales) },
    { date: 'cm2',           value: current.cm2,           pctOfGross: pct(current.cm2, current.grossSales) },
    { date: 'cm3',           value: current.cm3,           pctOfGross: pct(current.cm3, current.grossSales) },
    { date: 'netProfit',     value: current.netProfit,     pctOfGross: pct(current.netProfit, current.grossSales) },
  ]

  // Segment comparison (new vs returning) — unique to waterfall
  const segNew = toSummary(newCust)
  const segReturning = toSummary(returning)

  return {
    page: 'waterfall',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary,
    priorSummary,
    daily: steps,
    currency: 'INR',
    extra: {
      shiprocketBreakdown: {
        forwardCharges: current.forwardCharges,
        codCharges: current.codCharges,
        rtoCharges: current.rtoCharges,
      },
      newCustomers: segNew,
      returning: segReturning,
      hasNewVsReturning: newCust.ordersCount > 0 && returning.ordersCount > 0,
    },
  }
}
