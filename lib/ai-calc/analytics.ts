/**
 * Analytics calculator for AI context.
 * Uses shared COGS resolution (lib/cogs).
 */
import type { PrismaClient } from '@prisma/client'
import type { AiAnalyticsData, AiDailyRow, AiAnalyticsSummary } from './types'
import { eachDayOfInterval, getDaysInMonth } from 'date-fns'
import { computeLineItemsCogs, normalizeCogsSettings } from '@/lib/cogs'
import { getDailyVariableContribution } from '@/lib/workspace-costs'

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1, INR: 83.5, EUR: 0.92, GBP: 0.79, AUD: 1.53, CAD: 1.35,
}

function convertCurrency(amount: number, from: string, to: string) {
  if (!from || !to || from === to) return amount
  return (amount / (EXCHANGE_RATES[from] || 1)) * (EXCHANGE_RATES[to] || 1)
}

export async function calcAnalytics(
  prisma: PrismaClient,
  workspaceId: string,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  workspace: {
    cogsSettings: { overrideAllCogsPercent: unknown; fallbackCogsPercent: unknown; cogsMarkupPercent: unknown } | null
  }
): Promise<AiAnalyticsData> {
  const fromStr = fromDate.toISOString().slice(0, 10)
  const toStr = toDate.toISOString().slice(0, 10)

  const daily = await prisma.shopifyAnalyticsDaily.findMany({
    where: { connectionId, date: { gte: fromDate, lte: toDate } },
    orderBy: { date: 'asc' },
    select: {
      date: true, netSales: true, grossSales: true, totalTax: true, totalDiscount: true,
      ordersCount: true, aov: true, currency: true, sessions: true, conversionRate: true,
    },
  })

  // COGS map
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
      productShopifyId: true, quantity: true, price: true,
      order: { select: { processedAt: true } },
    },
  })

  const cogsSettings = normalizeCogsSettings(workspace.cogsSettings)
  const lineItemsWithDate = lineItems.map((item) => ({
    price: Number(item.price),
    quantity: Number(item.quantity),
    productShopifyId: item.productShopifyId,
    orderProcessedAt: item.order.processedAt,
  }))
  const { totalCogs, dailyCogs } = computeLineItemsCogs(lineItemsWithDate, coqMap, cogsSettings)

  // Costs
  const workspaceCosts = await prisma.workspaceCost.findMany({
    where: { workspaceId, effectiveFrom: { lte: toDate } },
  })

  const miscExpenses = await prisma.workspaceMiscExpense.findMany({
    where: { workspaceId, effectiveStartDate: { lte: toDate } },
  })

  const storeCurrency = daily[0]?.currency ?? 'INR'

  let totalShipping = 0
  let totalPackaging = 0
  let totalWebsiteCharges = 0
  const dailyCostsMap = new Map<string, { shipping: number; packaging: number; website: number }>()

  for (const d of daily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    const ordersCount = d.ordersCount
    const dayGrossSales = Number(d.grossSales)

    let dayShipping = 0
    let dayPackaging = 0
    let dayWebsiteCharge = 0

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
        else if (cost.costType === 'WEBSITE') dayWebsiteCharge += contribution
      }
    }
    totalShipping += dayShipping
    totalPackaging += dayPackaging
    totalWebsiteCharges += dayWebsiteCharge
    dailyCostsMap.set(dateStr, { shipping: dayShipping, packaging: dayPackaging, website: dayWebsiteCharge })
  }

  const totalNetSales = daily.reduce((sum, d) => sum + Number(d.netSales), 0)
  const totalGrossSales = daily.reduce((sum, d) => sum + Number(d.grossSales), 0)
  const totalTax = daily.reduce((sum, d) => sum + Number(d.totalTax), 0)
  const totalDiscount = daily.reduce((sum, d) => sum + Number(d.totalDiscount), 0)
  const totalOrders = daily.reduce((sum, d) => sum + d.ordersCount, 0)

  // Prepaid %
  const orderCounts = await prisma.shopifyOrder.groupBy({
    by: ['financialStatus'],
    where: { connectionId, processedAt: { gte: fromDate, lte: toDate } },
    _count: { id: true },
  })
  let prepaidCount = 0
  let totalForPrepaid = 0
  for (const g of orderCounts) {
    totalForPrepaid += g._count.id
    if (g.financialStatus?.toLowerCase() === 'paid') prepaidCount += g._count.id
  }
  const prepaidPercentage = totalForPrepaid > 0
    ? Math.round((prepaidCount / totalForPrepaid) * 10000) / 100
    : null

  // Sessions & conversion
  let totalSessions: number | null = null
  let conversionRate: number | null = null
  const dailyWithSessions = daily.filter((d) => d.sessions != null && Number(d.sessions) > 0)
  if (dailyWithSessions.length > 0) {
    totalSessions = dailyWithSessions.reduce((s, d) => s + (d.sessions ?? 0), 0)
    const sumConv = dailyWithSessions.reduce((s, d) => s + (d.conversionRate != null ? Number(d.conversionRate) : 0), 0)
    conversionRate = sumConv / dailyWithSessions.length
  }

  const cm1 = totalNetSales - totalCogs - totalShipping - totalPackaging - totalWebsiteCharges

  const dailyRows: AiDailyRow[] = daily.map((d) => {
    const dateStr = d.date.toISOString().slice(0, 10)
    const dayCogs = dailyCogs.get(dateStr) || 0
    const dCosts = dailyCostsMap.get(dateStr) || { shipping: 0, packaging: 0, website: 0 }
    const netSales = Number(d.netSales)
    const dayCm1 = netSales - dayCogs - dCosts.shipping - dCosts.packaging - dCosts.website
    return {
      date: dateStr,
      netSales,
      grossSales: Number(d.grossSales),
      totalTax: Number(d.totalTax),
      totalDiscount: Number(d.totalDiscount),
      ordersCount: d.ordersCount,
      aov: Number(d.aov),
      cogs: dayCogs,
      shipping: dCosts.shipping,
      packaging: dCosts.packaging,
      websiteCharges: dCosts.website,
      cm1: dayCm1,
      currency: d.currency ?? storeCurrency,
      sessions: d.sessions ?? null,
      conversionRate: d.conversionRate != null ? Number(d.conversionRate) : null,
    }
  })

  const summary: AiAnalyticsSummary = {
    totalNetSales,
    totalGrossSales,
    totalTax,
    totalDiscount,
    totalOrders,
    avgAov: totalOrders > 0 ? totalNetSales / totalOrders : 0,
    totalCogs,
    totalShipping,
    totalPackaging,
    totalWebsiteCharges,
    cm1,
    currency: storeCurrency,
    prepaidPercentage,
    totalSessions,
    conversionRate,
  }

  return { daily: dailyRows, summary }
}
