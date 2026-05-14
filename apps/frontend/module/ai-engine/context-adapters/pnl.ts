import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { getDaysInMonth } from 'date-fns'
import { computeLineItemsCogs, normalizeCogsSettings } from '@/lib/cogs'
import { getDailyVariableContribution } from '@/lib/workspace-costs'
import {
  getOrderInclusionWhereFromWorkspace,
  getFilteredDailyAggregates,
  hasNoOrderFilters,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import { totalChargesFromRaw } from '@/lib/shiprocket-charges'
import { fetchGoalRowsMap, buildGoalEvaluations } from '@/lib/metrics/goals'
import { GOAL_METRIC_REGISTRY, type GoalMetricId } from '@/lib/metrics/goal-metrics-registry'
import type { PageContext, DateRange, CompressedDailyRow, GoalContext } from './types'

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1, INR: 83.5, EUR: 0.92, GBP: 0.79, AUD: 1.53, CAD: 1.35,
}

function convertCurrency(amount: number, from: string, to: string) {
  if (!from || !to || from === to) return amount
  const fromRate = EXCHANGE_RATES[from] || 1
  const toRate = EXCHANGE_RATES[to] || 1
  return (amount / fromRate) * toRate
}

function computePriorPeriod(from: Date, to: Date): DateRange {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

/**
 * Computes P&L summary for a date range.
 * Replicates the P&L route logic using the same lib/ functions.
 */
async function computePnlSummary(
  prisma: PrismaClient,
  workspace: any,
  connectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<{ summary: Record<string, number | null>; daily: CompressedDailyRow[] }> {
  const storeCurrency = 'INR'
  const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)
  const orderInclusionWhere = getOrderInclusionWhereFromWorkspace(workspace as any)

  // Parallel data fetch
  const [
    analyticsRows,
    workspaceCosts,
    miscExpenses,
    products,
    lineItemsInRange,
    metaAdDaily,
    googleAdDaily,
    shiprocketShipments,
    allOrdersInRange,
    filteredDaily,
  ] = await Promise.all([
    prisma.shopifyAnalyticsDaily.findMany({
      where: { connectionId, date: { gte: fromDate, lte: toDate } },
      orderBy: { date: 'asc' },
      select: {
        date: true, netSales: true, grossSales: true, totalTax: true,
        totalDiscount: true, ordersCount: true, currency: true,
        total_returns: true, returns: true,
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
        productShopifyId: true, quantity: true, price: true,
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
      : Promise.resolve([]),
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
      : Promise.resolve([]),
    workspace.shiprocketConnection?.id && workspace.shiprocketConnection?.status === 'CONNECTED'
      ? prisma.shiprocketShipment.findMany({
          where: { connectionId: workspace.shiprocketConnection.id },
          select: { shippedAt: true, shiprocketCreatedAt: true, rawJson: true },
        })
      : Promise.resolve([]),
    prisma.shopifyOrder.findMany({
      where: {
        connectionId,
        processedAt: { gte: fromDate, lte: toDate },
        cancelledAt: null,
        ...orderInclusionWhere,
      },
      select: {
        id: true, customerShopifyId: true, processedAt: true,
        totalPrice: true, totalTax: true, totalDiscount: true,
      },
    }),
    hasNoOrderFilters(orderFilterSettings)
      ? Promise.resolve(new Map<string, { grossSales: number; ordersCount: number }>())
      : getFilteredDailyAggregates(prisma, connectionId, fromDate, toDate, orderFilterSettings),
  ])

  // Order-based fallback for missing analytics dates (same as PnL route lines 292-340)
  const analyticsDateSet = new Set(analyticsRows.map(d => d.date.toISOString().slice(0, 10)))
  const orderDerivedByDate = new Map<string, {
    grossSales: number; totalDiscount: number; totalTax: number; ordersCount: number
  }>()
  for (const o of allOrdersInRange) {
    const dateStr = o.processedAt.toISOString().slice(0, 10)
    const cur = orderDerivedByDate.get(dateStr) ?? {
      grossSales: 0, totalDiscount: 0, totalTax: 0, ordersCount: 0,
    }
    cur.grossSales += Number(o.totalPrice)
    cur.totalDiscount += Number(o.totalDiscount ?? 0)
    cur.totalTax += Number(o.totalTax)
    cur.ordersCount += 1
    orderDerivedByDate.set(dateStr, cur)
  }

  const orderOnlyDates = [...orderDerivedByDate.keys()].filter(d => !analyticsDateSet.has(d))
  const orderDerivedRows = orderOnlyDates.map(dateStr => {
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

  const effectiveDaily = [...analyticsRows, ...orderDerivedRows].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  )

  if (effectiveDaily.length === 0) {
    return {
      summary: {
        totalNetSales: 0, totalGrossSales: 0, totalRefunds: 0, totalRevenue: 0,
        totalNetRevenue: 0, totalCogs: 0, totalVariableCosts: 0, totalAdSpend: 0,
        metaAdSpend: 0, googleAdSpend: 0, cm1: 0, cm2: 0, cm3: 0,
        totalFixedCosts: 0, netProfit: 0, totalOrders: 0,
        cm1Pct: null, cm3Pct: null, netProfitPct: null,
        ncNetRevenue: 0, ecNetRevenue: 0, founderSalary: 0,
      },
      daily: [],
    }
  }

  // COGS
  const coqMap = new Map(products.filter(p => p.coq).map(p => [p.shopifyId, Number(p.coq)]))
  const cogsSettings = normalizeCogsSettings(workspace.cogsSettings)
  const lineItemsWithDate = lineItemsInRange.map((li: any) => ({
    price: Number(li.price),
    quantity: li.quantity,
    productShopifyId: li.productShopifyId,
    orderProcessedAt: li.order.processedAt,
  }))
  const { totalCogs, dailyCogs } = computeLineItemsCogs(lineItemsWithDate, coqMap, cogsSettings)

  // Daily refunds
  const dailyTotalReturns = new Map<string, number>()
  for (const d of effectiveDaily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    dailyTotalReturns.set(dateStr, Number(d.total_returns ?? 0))
  }

  // Daily ad spend
  const dailyAdSpendMap = new Map<string, number>()
  const dailyMetaMap = new Map<string, number>()
  const dailyGoogleMap = new Map<string, number>()
  let totalMetaAdSpend = 0
  let totalGoogleAdSpend = 0
  for (const r of metaAdDaily) {
    const d = r.date.toISOString().slice(0, 10)
    const spend = Number(r.spend)
    dailyMetaMap.set(d, (dailyMetaMap.get(d) ?? 0) + spend)
    dailyAdSpendMap.set(d, (dailyAdSpendMap.get(d) ?? 0) + spend)
    totalMetaAdSpend += spend
  }
  for (const r of googleAdDaily) {
    const d = r.date.toISOString().slice(0, 10)
    const spend = Number(r.spend)
    dailyGoogleMap.set(d, (dailyGoogleMap.get(d) ?? 0) + spend)
    dailyAdSpendMap.set(d, (dailyAdSpendMap.get(d) ?? 0) + spend)
    totalGoogleAdSpend += spend
  }
  const totalAdSpend = totalMetaAdSpend + totalGoogleAdSpend

  // Variable costs (workspace-defined: shipping, packaging, website)
  let totalVariableCosts = 0
  const dailyVarCostsMap = new Map<string, number>()
  for (const d of effectiveDaily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    const filtered = filteredDaily.get(dateStr)
    const dayOrders = filtered ? filtered.ordersCount : d.ordersCount
    const dayGross = filtered ? filtered.grossSales : Number(d.grossSales)
    let dayCost = 0
    for (const cost of workspaceCosts) {
      const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
      const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
      if (dateStr >= costFromStr && dateStr <= costToStr) {
        dayCost += getDailyVariableContribution(
          {
            costType: cost.costType,
            amount: Number(cost.amount),
            currency: cost.currency,
            isPercent: cost.isPercent,
            billingMode: cost.billingMode ?? 'monthly',
          },
          dateStr,
          dayOrders,
          dayGross,
          storeCurrency
        )
      }
    }
    totalVariableCosts += dayCost
    dailyVarCostsMap.set(dateStr, dayCost)
  }

  // Fixed costs (misc expenses prorated daily)
  let totalFixedCosts = 0
  const dailyFixedMap = new Map<string, number>()
  for (const d of effectiveDaily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    const dayDate = new Date(dateStr + 'T12:00:00.000Z')
    const daysInMonth = getDaysInMonth(dayDate)
    let dayFixed = 0
    for (const e of miscExpenses) {
      if (dateStr >= e.effectiveStartDate.toISOString().slice(0, 10)) {
        dayFixed += convertCurrency(Number(e.amount), e.currency || 'INR', storeCurrency) / daysInMonth
      }
    }
    totalFixedCosts += dayFixed
    dailyFixedMap.set(dateStr, dayFixed)
  }

  // Shiprocket shipping cost avg (prev month avg × orders)
  const monthPrevAvg = new Map<string, number>()
  if (shiprocketShipments.length > 0) {
    const shipmentsByMonth = new Map<string, { totalCharges: number; orderCount: number }>()
    for (const s of shiprocketShipments) {
      const at = (s as any).shippedAt ?? (s as any).shiprocketCreatedAt
      if (!at) continue
      const ym = at.toISOString().slice(0, 7)
      const total = totalChargesFromRaw((s as any).rawJson)
      const cur = shipmentsByMonth.get(ym) ?? { totalCharges: 0, orderCount: 0 }
      cur.totalCharges += total
      cur.orderCount += 1
      shipmentsByMonth.set(ym, cur)
    }
    const sortedMonths = Array.from(shipmentsByMonth.keys()).sort()
    for (let i = 1; i < sortedMonths.length; i++) {
      const prev = shipmentsByMonth.get(sortedMonths[i - 1])
      if (prev && prev.orderCount > 0) {
        monthPrevAvg.set(sortedMonths[i], prev.totalCharges / prev.orderCount)
      }
    }
  }

  // Founder salary
  const founderMonthly = workspace.founder_salary_monthly != null
    ? Number(workspace.founder_salary_monthly) : 0
  const founderCurrency = workspace.founder_salary_currency ?? 'INR'

  // NC/EC revenue split
  const firstAtMap = new Map<string, Date>()
  for (const order of allOrdersInRange) {
    const cid = order.customerShopifyId
    if (!cid || cid === '') continue
    const existing = firstAtMap.get(cid)
    if (!existing || order.processedAt < existing) {
      firstAtMap.set(cid, order.processedAt)
    }
  }
  let ncNetRevenue = 0
  let ecNetRevenue = 0
  for (const order of allOrdersInRange) {
    const rev = Number(order.totalPrice) - Number(order.totalTax)
    const custId = order.customerShopifyId
    const firstAt = custId ? firstAtMap.get(custId) : null
    const isFirst = firstAt != null && order.processedAt.getTime() === firstAt.getTime()
    if (isFirst) ncNetRevenue += rev
    else ecNetRevenue += rev
  }

  // Aggregate totals
  let totalGrossSales = 0
  let totalNetSales = 0
  let totalRefunds = 0
  let totalTax = 0
  let totalOrders = 0
  let totalShippingCosts = 0

  const compressed: CompressedDailyRow[] = []

  for (const d of effectiveDaily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    const filtered = filteredDaily.get(dateStr)
    const grossSales = filtered ? filtered.grossSales : Number(d.grossSales)
    const discounts = Math.abs(Number(d.totalDiscount))
    const netSales = grossSales - discounts
    const ordersCount = filtered ? filtered.ordersCount : d.ordersCount
    const refunds = Number(d.total_returns ?? 0)
    const tax = Number(d.totalTax)

    totalGrossSales += grossSales
    totalNetSales += netSales
    totalRefunds += refunds
    totalTax += tax
    totalOrders += ordersCount

    const dayCogs = dailyCogs.get(dateStr) ?? 0
    const dayVarCosts = dailyVarCostsMap.get(dateStr) ?? 0
    const dayAdSpend = dailyAdSpendMap.get(dateStr) ?? 0
    const dayFixed = dailyFixedMap.get(dateStr) ?? 0

    // Shiprocket shipping cost for this day's month
    const monthKey = dateStr.slice(0, 7)
    const prevAvg = monthPrevAvg.get(monthKey) ?? 0
    const dayShippingCost = prevAvg * ordersCount
    totalShippingCosts += dayShippingCost

    // Founder salary daily allocation
    const dayDate = new Date(dateStr + 'T12:00:00.000Z')
    const daysInMonth = getDaysInMonth(dayDate)
    const dayFounderSalary = convertCurrency(founderMonthly, founderCurrency, storeCurrency) / daysInMonth

    const dayCm1 = netSales - dayCogs - dayVarCosts
    const dayCm2 = dayCm1 - dayAdSpend
    const dayCm3 = dayCm2 - dayFixed
    const dayNetProfit = dayCm3 - dayFounderSalary

    compressed.push({
      date: dateStr,
      netSales: Math.round(netSales),
      cogs: Math.round(dayCogs),
      variableCosts: Math.round(dayVarCosts),
      adSpend: Math.round(dayAdSpend),
      cm1: Math.round(dayCm1),
      cm2: Math.round(dayCm2),
      cm3: Math.round(dayCm3),
      netProfit: Math.round(dayNetProfit),
    })
  }

  const totalRevenue = totalGrossSales - Math.abs(totalRefunds)
  const totalNetRevenue = totalRevenue - totalTax
  const materialMargin = totalNetSales - totalCogs
  const materialMarginPct = totalNetSales > 0 ? Math.round((materialMargin / totalNetSales) * 10000) / 100 : null
  const cm1 = totalNetSales - totalCogs - totalVariableCosts
  const cm2 = cm1 - totalAdSpend
  const cm2Pct = totalNetSales > 0 ? Math.round((cm2 / totalNetSales) * 10000) / 100 : null
  const cm3 = cm2 - totalFixedCosts
  const totalDays = effectiveDaily.length
  const totalFounderSalary = totalDays > 0
    ? effectiveDaily.reduce((sum, d) => {
        const dayDate = new Date(d.date.toISOString().slice(0, 10) + 'T12:00:00.000Z')
        return sum + convertCurrency(founderMonthly, founderCurrency, storeCurrency) / getDaysInMonth(dayDate)
      }, 0)
    : 0
  const netProfit = cm3 - totalFounderSalary

  return {
    summary: {
      totalNetSales: Math.round(totalNetSales),
      totalGrossSales: Math.round(totalGrossSales),
      totalRefunds: Math.round(totalRefunds),
      totalRevenue: Math.round(totalRevenue),
      totalNetRevenue: Math.round(totalNetRevenue),
      totalCogs: Math.round(totalCogs),
      materialMargin: Math.round(materialMargin),
      materialMarginPct,
      totalVariableCosts: Math.round(totalVariableCosts),
      totalShippingCosts: Math.round(totalShippingCosts),
      totalAdSpend: Math.round(totalAdSpend),
      metaAdSpend: Math.round(totalMetaAdSpend),
      googleAdSpend: Math.round(totalGoogleAdSpend),
      cm1: Math.round(cm1),
      cm1Pct: totalNetSales > 0 ? Math.round((cm1 / totalNetSales) * 10000) / 100 : null,
      cm2: Math.round(cm2),
      cm2Pct,
      cm3: Math.round(cm3),
      totalFixedCosts: Math.round(totalFixedCosts),
      founderSalary: Math.round(totalFounderSalary),
      netProfit: Math.round(netProfit),
      totalOrders,
      cm3Pct: totalNetSales > 0 ? Math.round((cm3 / totalNetSales) * 10000) / 100 : null,
      netProfitPct: totalNetSales > 0 ? Math.round((netProfit / totalNetSales) * 10000) / 100 : null,
      ncNetRevenue: Math.round(ncNetRevenue),
      ecNetRevenue: Math.round(ecNetRevenue),
    },
    daily: compressed,
  }
}

/**
 * Builds the full P&L context for AI insight generation.
 * Fetches data for both current and prior period, compresses for token efficiency.
 */
export async function buildPnlContext(
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

  if (!connectionId) {
    return {
      page: 'pnl',
      workspaceId,
      dateRange: { from: dateFrom, to: dateTo },
      priorDateRange: priorRange,
      summary: {},
      priorSummary: {},
      daily: [],
      currency: 'INR',
    }
  }

  // Fetch current, prior, and workspace goals in parallel
  const goalMetricIds: GoalMetricId[] = ['revenue', 'cm3', 'cm3_pct', 'mer', 'acos', 'aov']
  const [current, prior, goalRows] = await Promise.all([
    computePnlSummary(prisma, workspace, connectionId, dateFrom, dateTo),
    computePnlSummary(prisma, workspace, connectionId, priorRange.from, priorRange.to),
    fetchGoalRowsMap(prisma, workspaceId, goalMetricIds, dateTo),
  ])

  // Evaluate goals against actuals
  const goalActuals: Partial<Record<GoalMetricId, number | null>> = {
    revenue: current.summary.totalNetSales,
    cm3: current.summary.cm3,
    cm3_pct: current.summary.cm3Pct,
    mer: current.summary.totalAdSpend && current.summary.totalNetSales
      ? Math.round((current.summary.totalNetSales / current.summary.totalAdSpend) * 100) / 100
      : null,
    acos: current.summary.totalNetSales && current.summary.totalAdSpend
      ? Math.round((current.summary.totalAdSpend / current.summary.totalNetSales) * 10000) / 100
      : null,
    aov: current.summary.totalOrders
      ? Math.round((current.summary.totalNetSales ?? 0) / current.summary.totalOrders)
      : null,
  }
  const goalEvals = buildGoalEvaluations(goalActuals, goalRows)
  const goals: GoalContext[] = Object.entries(goalEvals).map(([key, ev]) => ({
    metricName: key,
    label: GOAL_METRIC_REGISTRY[key as GoalMetricId]?.label ?? key,
    goal: ev.goal,
    actual: ev.actual,
    variancePct: ev.variancePct,
    rag: ev.rag,
  }))

  // Cap daily to last 30 rows for token budget
  const cappedDaily = current.daily.length > 30
    ? current.daily.slice(-30)
    : current.daily

  return {
    page: 'pnl',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: current.summary,
    priorSummary: prior.summary,
    daily: cappedDaily,
    currency: 'INR',
    goals: goals.length > 0 ? goals : undefined,
  }
}
