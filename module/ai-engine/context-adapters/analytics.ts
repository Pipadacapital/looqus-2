import type { PrismaClient } from '@prisma/client'
import { eachDayOfInterval, getDaysInMonth } from 'date-fns'
import { computeLineItemsCogs, normalizeCogsSettings } from '@/lib/cogs'
import { getDailyVariableContribution } from '@/lib/workspace-costs'
import { getOrderInclusionWhereFromWorkspace } from '@/lib/order-filters'
import { getRtoSummary } from '@/lib/workspace-metrics'
import { fetchGoalRowsMap, buildGoalEvaluations } from '@/lib/metrics/goals'
import { GOAL_METRIC_REGISTRY, type GoalMetricId } from '@/lib/metrics/goal-metrics-registry'
import type { PageContext, DateRange, CompressedDailyRow, GoalContext } from './types'

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  INR: 83.5,
  EUR: 0.92,
  GBP: 0.79,
  AUD: 1.53,
  CAD: 1.35,
}

function convertCurrency(amount: number, from: string, to: string) {
  if (!from || !to || from === to) return amount
  const fromRate = EXCHANGE_RATES[from] || 1
  const toRate = EXCHANGE_RATES[to] || 1
  return (amount / fromRate) * toRate
}

/**
 * Computes the prior period date range: same duration, shifted back.
 * E.g., if current is Mar 1–30 (30 days), prior is Jan 30 – Feb 28.
 */
function computePriorPeriod(from: Date, to: Date): DateRange {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1) // day before current from
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

/**
 * Fetches analytics summary for a date range using the same lib/ functions
 * as the shopify-analytics API route.
 */
async function computeAnalyticsSummary(
  prisma: PrismaClient,
  workspace: any,
  connectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<{ summary: Record<string, number | null>; daily: CompressedDailyRow[] }> {
  // 1. Daily aggregates
  const dailyRows = await prisma.shopifyAnalyticsDaily.findMany({
    where: { connectionId, date: { gte: fromDate, lte: toDate } },
    orderBy: { date: 'asc' },
    select: {
      date: true,
      netSales: true,
      grossSales: true,
      totalTax: true,
      totalDiscount: true,
      ordersCount: true,
      aov: true,
      currency: true,
      sessions: true,
      conversionRate: true,
    },
  })

  if (dailyRows.length === 0) {
    return {
      summary: {
        totalNetSales: 0, totalGrossSales: 0, totalTax: 0, totalDiscount: 0,
        totalOrders: 0, avgAov: 0, totalCogs: 0, totalShipping: 0,
        totalPackaging: 0, totalWebsiteCharges: 0, cm1: 0, cm2: 0,
        miscExpensesTotal: 0, cm3: 0, cm3Pct: null, metaAdSpend: 0,
        googleAdSpend: 0, totalAdSpend: 0, mer: null, acos: null,
        prepaidPercentage: null, totalSessions: null, conversionRate: null,
        rtoOrders: 0, rtoPercent: null, rtoValue: 0,
      },
      daily: [],
    }
  }

  // 2. COGS
  const products = await prisma.shopifyProduct.findMany({
    where: { connectionId },
    select: { shopifyId: true, coq: true },
  })
  const coqMap = new Map<string, number>()
  for (const p of products) {
    if (p.coq) coqMap.set(p.shopifyId, Number(p.coq))
  }

  const lineItems = await prisma.shopifyLineItem.findMany({
    where: {
      connectionId,
      order: { processedAt: { gte: fromDate, lte: toDate } },
    },
    select: {
      productShopifyId: true,
      quantity: true,
      price: true,
      order: { select: { processedAt: true } },
    },
  })

  const cogsSettings = normalizeCogsSettings(workspace.cogsSettings)
  const lineItemsWithDate = lineItems.map((item: any) => ({
    price: Number(item.price),
    quantity: Number(item.quantity),
    productShopifyId: item.productShopifyId,
    orderProcessedAt: item.order.processedAt,
  }))
  const { totalCogs, dailyCogs } = computeLineItemsCogs(lineItemsWithDate, coqMap, cogsSettings)

  // 3. Workspace costs
  const workspaceCosts = await prisma.workspaceCost.findMany({
    where: { workspaceId: workspace.id, effectiveFrom: { lte: toDate } },
  })

  const storeCurrency = dailyRows[0]?.currency ?? 'USD'
  let totalShipping = 0
  let totalPackaging = 0
  let totalWebsiteCharges = 0
  const dailyCostsMap = new Map<string, { shipping: number; packaging: number; website: number }>()

  for (const d of dailyRows) {
    const dateStr = d.date.toISOString().slice(0, 10)
    const ordersCount = d.ordersCount
    const dayGrossSales = Number(d.grossSales)
    let dayShipping = 0, dayPackaging = 0, dayWebsite = 0

    for (const cost of workspaceCosts) {
      const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
      const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
      if (dateStr >= costFromStr && dateStr <= costToStr) {
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
          dayGrossSales,
          storeCurrency
        )
        if (cost.costType === 'SHIPPING') dayShipping += contribution
        else if (cost.costType === 'PACKAGING') dayPackaging += contribution
        else if (cost.costType === 'WEBSITE') dayWebsite += contribution
      }
    }

    totalShipping += dayShipping
    totalPackaging += dayPackaging
    totalWebsiteCharges += dayWebsite
    dailyCostsMap.set(dateStr, { shipping: dayShipping, packaging: dayPackaging, website: dayWebsite })
  }

  // 4. Revenue aggregates
  const totalNetSales = dailyRows.reduce((sum, d) => sum + Number(d.netSales), 0)
  const totalGrossSales = dailyRows.reduce((sum, d) => sum + Number(d.grossSales), 0)
  const totalTax = dailyRows.reduce((sum, d) => sum + Number(d.totalTax), 0)
  const totalDiscount = dailyRows.reduce((sum, d) => sum + Number(d.totalDiscount), 0)
  const totalOrders = dailyRows.reduce((sum, d) => sum + d.ordersCount, 0)

  // 5. Prepaid %
  const orderCounts = await prisma.shopifyOrder.groupBy({
    by: ['financialStatus'],
    where: { connectionId, processedAt: { gte: fromDate, lte: toDate } },
    _count: { id: true },
  })
  let prepaidCount = 0, ordersForPrepaid = 0
  for (const g of orderCounts) {
    ordersForPrepaid += g._count.id
    if (g.financialStatus?.toLowerCase() === 'paid') prepaidCount += g._count.id
  }
  const prepaidPercentage = ordersForPrepaid > 0
    ? Math.round((prepaidCount / ordersForPrepaid) * 10000) / 100
    : null

  // 6. Sessions & conversion rate
  let totalSessions: number | null = null
  let conversionRate: number | null = null
  const withSessions = dailyRows.filter(d => d.sessions != null && Number(d.sessions) > 0)
  if (withSessions.length > 0) {
    totalSessions = withSessions.reduce((s, d) => s + (d.sessions ?? 0), 0)
    const sumConv = withSessions.reduce((s, d) => s + (d.conversionRate != null ? Number(d.conversionRate) : 0), 0)
    conversionRate = sumConv / withSessions.length
  } else {
    const anyConv = dailyRows.filter(d => d.conversionRate != null)
    if (anyConv.length > 0) {
      conversionRate = anyConv.reduce((s, d) => s + Number(d.conversionRate!), 0) / anyConv.length
    }
  }

  // 7. Ad spend (daily breakdown for trend analysis)
  let metaAdSpend = 0
  let googleAdSpend = 0
  const dailyAdSpendMap = new Map<string, number>()
  const metaConn = workspace.meta_ads_connections
  const googleConn = workspace.google_ads_connections

  if (metaConn?.id) {
    const metaSelectedIds = metaConn.selected_ad_account_ids?.length
      ? metaConn.selected_ad_account_ids
      : metaConn.selected_ad_account_id ? [metaConn.selected_ad_account_id] : undefined

    const metaWhere: Record<string, unknown> = {
      connection_id: metaConn.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (metaSelectedIds) metaWhere.ad_account_id = { in: metaSelectedIds }

    const metaRows = await prisma.meta_ads_daily_metrics.findMany({
      where: metaWhere as any,
      select: { date: true, spend: true },
    })
    for (const r of metaRows) {
      const spend = Number(r.spend)
      metaAdSpend += spend
      const d = r.date.toISOString().slice(0, 10)
      dailyAdSpendMap.set(d, (dailyAdSpendMap.get(d) ?? 0) + spend)
    }
  }

  if (googleConn?.id) {
    const googleSelectedIds = googleConn.selected_customer_ids?.length
      ? googleConn.selected_customer_ids
      : googleConn.selected_customer_id ? [googleConn.selected_customer_id] : undefined

    const googleWhere: Record<string, unknown> = {
      connection_id: googleConn.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (googleSelectedIds) googleWhere.customer_id = { in: googleSelectedIds }

    const googleRows = await prisma.google_ads_daily_metrics.findMany({
      where: googleWhere as any,
      select: { date: true, spend: true },
    })
    for (const r of googleRows) {
      const spend = Number(r.spend)
      googleAdSpend += spend
      const d = r.date.toISOString().slice(0, 10)
      dailyAdSpendMap.set(d, (dailyAdSpendMap.get(d) ?? 0) + spend)
    }
  }

  const totalAdSpend = metaAdSpend + googleAdSpend

  // 8. RTO
  let rtoOrders = 0, rtoPercent: number | null = null, rtoValue = 0
  const srConn = workspace.shiprocketConnection
  if (srConn?.status === 'CONNECTED') {
    const orderInclusionWhere = getOrderInclusionWhereFromWorkspace(workspace as any)
    const rto = await getRtoSummary(prisma, connectionId, srConn.id, fromDate, toDate, orderInclusionWhere)
    rtoOrders = rto.rtoOrders
    rtoPercent = rto.rtoPercent
    rtoValue = rto.rtoValue
  }

  // 9. Misc expenses
  const miscExpenses = await prisma.workspaceMiscExpense.findMany({
    where: { workspaceId: workspace.id, effectiveStartDate: { lte: toDate } },
  })
  const miscExpensesTotal = miscExpenses.reduce((sum, e) => {
    const monthlyAmt = convertCurrency(Number(e.amount), e.currency || 'INR', storeCurrency)
    const expStart = new Date(e.effectiveStartDate)
    const applyFrom = expStart > fromDate ? expStart : fromDate
    if (applyFrom > toDate) return sum
    const overlapStart = new Date(`${applyFrom.toISOString().slice(0, 10)}T00:00:00.000Z`)
    const overlapEnd = new Date(`${toDate.toISOString().slice(0, 10)}T00:00:00.000Z`)
    const days = eachDayOfInterval({ start: overlapStart, end: overlapEnd })
    return sum + days.reduce((s, d) => s + monthlyAmt / getDaysInMonth(d), 0)
  }, 0)

  // 10. Contribution margins
  const materialMargin = totalNetSales - totalCogs
  const materialMarginPct = totalNetSales > 0 ? Math.round((materialMargin / totalNetSales) * 10000) / 100 : null
  const variableCosts = totalShipping + totalPackaging + totalWebsiteCharges
  const cm1 = materialMargin - variableCosts
  const cm1Pct = totalNetSales > 0 ? Math.round((cm1 / totalNetSales) * 10000) / 100 : null
  const cm2 = cm1 - totalAdSpend
  const cm2Pct = totalNetSales > 0 ? Math.round((cm2 / totalNetSales) * 10000) / 100 : null
  const cm3 = cm2 - miscExpensesTotal
  const cm3Pct = totalNetSales > 0 ? Math.round((cm3 / totalNetSales) * 10000) / 100 : null
  const mer = totalAdSpend > 0 ? Math.round((totalNetSales / totalAdSpend) * 100) / 100 : null
  const acos = totalNetSales > 0 ? Math.round((totalAdSpend / totalNetSales) * 10000) / 100 : null

  // 11. Build compressed daily rows
  const compressed: CompressedDailyRow[] = dailyRows.map(d => {
    const dateStr = d.date.toISOString().slice(0, 10)
    const dayCogs = dailyCogs.get(dateStr) || 0
    const dCosts = dailyCostsMap.get(dateStr) || { shipping: 0, packaging: 0, website: 0 }
    const netSales = Number(d.netSales)
    const dayAdSpend = dailyAdSpendMap.get(dateStr) ?? 0
    const dayCm1 = netSales - dayCogs - dCosts.shipping - dCosts.packaging - dCosts.website
    const dayCm2 = dayCm1 - dayAdSpend
    return {
      date: dateStr,
      netSales: Math.round(netSales),
      ordersCount: d.ordersCount,
      aov: Math.round(Number(d.aov)),
      cogs: Math.round(dayCogs),
      adSpend: Math.round(dayAdSpend),
      cm1: Math.round(dayCm1),
      cm2: Math.round(dayCm2),
    }
  })

  return {
    summary: {
      totalNetSales: Math.round(totalNetSales),
      totalGrossSales: Math.round(totalGrossSales),
      totalTax: Math.round(totalTax),
      totalDiscount: Math.round(totalDiscount),
      totalOrders,
      avgAov: totalOrders > 0 ? Math.round(totalNetSales / totalOrders) : 0,
      totalCogs: Math.round(totalCogs),
      materialMargin: Math.round(materialMargin),
      materialMarginPct,
      totalShipping: Math.round(totalShipping),
      totalPackaging: Math.round(totalPackaging),
      totalWebsiteCharges: Math.round(totalWebsiteCharges),
      cm1: Math.round(cm1),
      cm1Pct,
      cm2: Math.round(cm2),
      cm2Pct,
      miscExpensesTotal: Math.round(miscExpensesTotal),
      cm3: Math.round(cm3),
      cm3Pct,
      metaAdSpend: Math.round(metaAdSpend),
      googleAdSpend: Math.round(googleAdSpend),
      totalAdSpend: Math.round(totalAdSpend),
      mer,
      acos,
      prepaidPercentage,
      totalSessions,
      conversionRate,
      rtoOrders,
      rtoPercent,
      rtoValue: Math.round(rtoValue),
    },
    daily: compressed,
  }
}

/**
 * Builds the full analytics context for AI insight generation.
 * Fetches data for both current and prior period, compresses for token efficiency.
 */
export async function buildAnalyticsContext(
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
      page: 'analytics',
      workspaceId,
      dateRange: { from: dateFrom, to: dateTo },
      priorDateRange: priorRange,
      summary: {},
      priorSummary: {},
      daily: [],
      currency: 'USD',
    }
  }

  // Fetch current, prior, and workspace goals in parallel
  const goalMetricIds: GoalMetricId[] = ['revenue', 'cm3', 'cm3_pct', 'mer', 'acos', 'aov', 'new_customers']
  const [current, prior, goalRows] = await Promise.all([
    computeAnalyticsSummary(prisma, workspace, connectionId, dateFrom, dateTo),
    computeAnalyticsSummary(prisma, workspace, connectionId, priorRange.from, priorRange.to),
    fetchGoalRowsMap(prisma, workspaceId, goalMetricIds, dateTo),
  ])

  // Evaluate goals against actuals
  const goalActuals: Partial<Record<GoalMetricId, number | null>> = {
    revenue: current.summary.totalNetSales,
    cm3: current.summary.cm3,
    cm3_pct: current.summary.cm3Pct,
    mer: current.summary.mer,
    acos: current.summary.acos,
    aov: current.summary.avgAov,
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

  const currency = (current.summary.currency as unknown as string) ??
    (current.daily[0] as any)?.currency ?? 'INR'

  return {
    page: 'analytics',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: current.summary,
    priorSummary: prior.summary,
    daily: cappedDaily,
    currency: typeof currency === 'string' ? currency : 'INR',
    goals: goals.length > 0 ? goals : undefined,
  }
}
