/**
 * P&L calculator for AI context.
 * Mirrors shopify-analytics/route.ts exactly so AI Insights shows
 * the same CM1 / CM2 / CM3 figures as the Analytics page.
 */
import type { PrismaClient } from '@prisma/client'
import type { AiPnlData, AiPnlSummary } from './types'
import { getDaysInMonth, eachDayOfInterval } from 'date-fns'

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1, INR: 83.5, EUR: 0.92, GBP: 0.79, AUD: 1.53, CAD: 1.35,
}

function convertCurrency(amount: number, from: string, to: string) {
  if (!from || !to || from === to) return amount
  return (amount / (EXCHANGE_RATES[from] || 1)) * (EXCHANGE_RATES[to] || 1)
}

interface PnlWorkspace {
  id: string
  founderSalaryMonthly: unknown
  founderSalaryCurrency: string | null
  shopifyConnections: { id: string }[]
  cogsSettings: {
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
}

export async function calcPnl(
  prisma: PrismaClient,
  workspace: PnlWorkspace,
  fromDate: Date,
  toDate: Date,
): Promise<AiPnlData> {

  const connectionId = workspace.shopifyConnections[0]?.id
  const storeCurrency = 'INR'

  if (!connectionId) {
    return { summary: emptyPnl(), currency: storeCurrency }
  }

  const [
    dailyAnalytics, workspaceCosts, miscExpenses, products, lineItems,
    metaAdDaily, googleAdDaily,
  ] = await Promise.all([
    prisma.shopifyAnalyticsDaily.findMany({
      where: { connectionId, date: { gte: fromDate, lte: toDate } },
      orderBy: { date: 'asc' },
      select: {
        date: true, netSales: true, grossSales: true, totalTax: true,
        totalDiscount: true, ordersCount: true, currency: true,
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
      where: { connectionId, order: { processedAt: { gte: fromDate, lte: toDate } } },
      select: {
        productShopifyId: true, quantity: true, price: true,
        order: { select: { processedAt: true } },
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
  ])

  // ── COGS (mirrors shopify-analytics/route.ts lines 168-204 exactly) ──────
  const cogsSettings = workspace.cogsSettings
  const overridePct = cogsSettings ? Number(cogsSettings.overrideAllCogsPercent) : 0
  const fallbackPct = cogsSettings ? Number(cogsSettings.fallbackCogsPercent) : 0
  const markupPct = cogsSettings ? Number(cogsSettings.cogsMarkupPercent) : 0
  const coqMap = new Map(products.filter(p => p.coq).map(p => [p.shopifyId, Number(p.coq)]))

  let totalCogs = 0
  for (const item of lineItems) {
    const revenue = Number(item.price) * item.quantity
    let baseCogs: number
    if (overridePct > 0) {
      baseCogs = revenue * (overridePct / 100)
    } else {
      const coq = item.productShopifyId ? (coqMap.get(item.productShopifyId) ?? 0) : 0
      if (coq > 0) {
        baseCogs = coq * item.quantity
      } else if (fallbackPct > 0) {
        baseCogs = revenue * (fallbackPct / 100)
      } else {
        baseCogs = 0
      }
    }
    totalCogs += markupPct > 0 ? baseCogs * (1 + markupPct / 100) : baseCogs
  }

  // ── Net Sales (DB field directly — mirrors shopify-analytics/route.ts line 243) ──
  const totalNetSales = dailyAnalytics.reduce((sum, d) => sum + Number(d.netSales), 0)
  const totalGrossSales = dailyAnalytics.reduce((sum, d) => sum + Number(d.grossSales), 0)
  const totalDiscount = dailyAnalytics.reduce((sum, d) => sum + Number(d.totalDiscount), 0)
  const ordersCount = dailyAnalytics.reduce((sum, d) => sum + d.ordersCount, 0)

  // ── Variable costs (SHIPPING + PACKAGING + WEBSITE only — mirrors route.ts lines 465-504) ──
  let totalShipping = 0, totalPackaging = 0, totalWebsiteCharges = 0
  for (const d of dailyAnalytics) {
    const dateStr = d.date.toISOString().slice(0, 10)
    const dayOrders = d.ordersCount
    const dayGrossSales = Number(d.grossSales)
    let dayShippingPerOrder = 0, dayPackagingPerOrder = 0, dayWebsiteCharge = 0
    for (const cost of workspaceCosts) {
      const cFrom = cost.effectiveFrom.toISOString().slice(0, 10)
      const cTo = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
      if (dateStr >= cFrom && dateStr <= cTo) {
        if (cost.costType === 'SHIPPING')
          dayShippingPerOrder += convertCurrency(Number(cost.amount), cost.currency || 'USD', storeCurrency)
        else if (cost.costType === 'PACKAGING')
          dayPackagingPerOrder += convertCurrency(Number(cost.amount), cost.currency || 'USD', storeCurrency)
        else if (cost.costType === 'WEBSITE') {
          if (cost.isPercent) dayWebsiteCharge += (Number(cost.amount) / 100) * dayGrossSales
          else dayWebsiteCharge += convertCurrency(Number(cost.amount), cost.currency || 'USD', storeCurrency) * dayOrders
        }
      }
    }
    totalShipping += dayShippingPerOrder * dayOrders
    totalPackaging += dayPackagingPerOrder * dayOrders
    totalWebsiteCharges += dayWebsiteCharge
  }

  // ── Ad spend ──────────────────────────────────────────────────────────────
  let metaAdSpend = 0, googleAdSpend = 0
  for (const r of metaAdDaily) metaAdSpend += Number(r.spend)
  for (const r of googleAdDaily) googleAdSpend += Number(r.spend)
  const totalAdSpend = metaAdSpend + googleAdSpend

  // ── Misc expenses (mirrors shopify-analytics/route.ts lines 513-525 exactly) ──
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

  // ── Founder salary (prorated, only if set) ───────────────────────────────
  const founderMonthly = workspace.founderSalaryMonthly != null ? Number(workspace.founderSalaryMonthly) : 0
  const founderCurr = workspace.founderSalaryCurrency ?? 'INR'
  const allDaysInRange = eachDayOfInterval({ start: fromDate, end: toDate })
  const founderSalary = allDaysInRange.reduce((sum, day) =>
    sum + convertCurrency(founderMonthly, founderCurr, storeCurrency) / getDaysInMonth(day), 0)

  // ── CM cascade (mirrors shopify-analytics/route.ts lines 510-526) ────────
  const cm1 = totalNetSales - totalCogs - totalShipping - totalPackaging - totalWebsiteCharges
  const cm2 = cm1 - totalAdSpend
  const cm3 = cm2 - miscExpensesTotal
  const netProfit = cm3 - founderSalary

  const margin = (val: number) => totalNetSales > 0
    ? Math.round((val / totalNetSales) * 10000) / 100 : null

  const summary: AiPnlSummary = {
    grossSales: totalGrossSales,
    discounts: Math.abs(totalDiscount),
    netSales: totalNetSales,
    refunds: 0,
    revenue: totalGrossSales,
    netRevenue: totalNetSales,
    cogs: totalCogs,
    variableCosts: totalShipping + totalPackaging + totalWebsiteCharges,
    shippingCosts: totalShipping,
    cm1,
    adSpend: totalAdSpend,
    metaAdSpend,
    googleAdSpend,
    cm2,
    fixedCosts: miscExpensesTotal,
    cm3,
    founderSalary,
    netProfit,
    ordersCount,
    cm1Margin: margin(cm1),
    cm2Margin: margin(cm2),
    cm3Margin: margin(cm3),
    netProfitMargin: margin(netProfit),
  }

  return { summary, currency: storeCurrency }
}

function emptyPnl(): AiPnlSummary {
  return {
    grossSales: 0, discounts: 0, netSales: 0, refunds: 0, revenue: 0, netRevenue: 0,
    cogs: 0, variableCosts: 0, shippingCosts: 0, cm1: 0,
    adSpend: 0, metaAdSpend: 0, googleAdSpend: 0, cm2: 0,
    fixedCosts: 0, cm3: 0, founderSalary: 0, netProfit: 0, ordersCount: 0,
    cm1Margin: null, cm2Margin: null, cm3Margin: null, netProfitMargin: null,
  }
}
