import type { PrismaClient } from '@prisma/client'
import { computeProducts } from '@/lib/products/compute'
import { getEffectiveDailyAggregates } from '@/lib/effective-daily'
import type { ProductsRow } from '@/lib/products/types'
import type { PageContext, CompressedDailyRow } from './types'

function computePriorPeriod(from: Date, to: Date) {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

export type ProductSummaryRow = {
  label: string
  paretoGrade: 'A' | 'B' | 'C' | 'F'
  cm1: number
  cm1Pct: number
  cm1Total: number
  revenue: number
  sales: number
  refunds: number
  sold: number
  returnRate: number
  ncOrders: number
  ecOrders: number
  orders: number
  ncAov: number
  ecAov: number
  aov: number
}

function buildSummaryFromRows(rows: ProductsRow[]): Record<string, number | null> {
  if (rows.length === 0) return {}

  let totalRevenue = 0
  let totalCm1 = 0
  let totalSales = 0
  let totalRefunds = 0
  let totalSold = 0
  let gradeA = 0, gradeB = 0, gradeC = 0, gradeF = 0
  let negativeCm1Count = 0
  let positiveCm1Count = 0
  let returnRateSum = 0
  let returnRateCount = 0

  for (const r of rows) {
    totalRevenue += r.revenue
    totalCm1 += r.cm1Total
    totalSales += r.sales
    totalRefunds += r.refunds
    totalSold += r.sold
    if (r.paretoGrade === 'A') gradeA++
    else if (r.paretoGrade === 'B') gradeB++
    else if (r.paretoGrade === 'C') gradeC++
    else gradeF++
    if (r.cm1Total < 0) negativeCm1Count++
    else positiveCm1Count++
    if (r.returnRate > 0) {
      returnRateSum += r.returnRate
      returnRateCount++
    }
  }

  const avgCm1Pct = totalRevenue > 0
    ? Math.round((totalCm1 / totalRevenue) * 10000) / 100
    : null
  const avgReturnRate = returnRateCount > 0
    ? Math.round((returnRateSum / returnRateCount) * 100) / 100
    : null

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCm1: Math.round(totalCm1 * 100) / 100,
    totalSales: Math.round(totalSales * 100) / 100,
    totalRefunds: Math.round(totalRefunds * 100) / 100,
    totalSold,
    avgCm1Pct,
    avgReturnRate,
    totalProducts: rows.length,
    gradeACount: gradeA,
    gradeBCount: gradeB,
    gradeCCount: gradeC,
    gradeFCount: gradeF,
    negativeCm1Products: negativeCm1Count,
    positiveCm1Products: positiveCm1Count,
  }
}

function compressProduct(r: ProductsRow): ProductSummaryRow {
  return {
    label: r.label,
    paretoGrade: r.paretoGrade,
    cm1: Math.round(r.cm1 * 100) / 100,
    cm1Pct: Math.round(r.cm1Pct * 100) / 100,
    cm1Total: Math.round(r.cm1Total * 100) / 100,
    revenue: Math.round(r.revenue * 100) / 100,
    sales: Math.round(r.sales * 100) / 100,
    refunds: Math.round(r.refunds * 100) / 100,
    sold: r.sold,
    returnRate: Math.round(r.returnRate * 100) / 100,
    ncOrders: r.ncOrders,
    ecOrders: r.ecOrders,
    orders: r.orders,
    ncAov: Math.round(r.ncAov * 100) / 100,
    ecAov: Math.round(r.ecAov * 100) / 100,
    aov: Math.round(r.aov * 100) / 100,
  }
}

export async function buildProductsContext(
  prisma: PrismaClient,
  workspaceId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<PageContext> {
  const priorRange = computePriorPeriod(dateFrom, dateTo)
  const fromStr = dateFrom.toISOString().slice(0, 10)
  const toStr = dateTo.toISOString().slice(0, 10)
  const priorFromStr = priorRange.from.toISOString().slice(0, 10)
  const priorToStr = priorRange.to.toISOString().slice(0, 10)

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
    },
  })

  const empty: PageContext = {
    page: 'products',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: {},
    priorSummary: {},
    daily: [],
    currency: 'INR',
  }

  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) return empty

  // Fetch top 100 products by CM1 for both periods in parallel
  // Also fetch daily aggregates for temporal context (anomaly/trend detection)
  const [currentResult, priorResult, dailyMap] = await Promise.all([
    computeProducts(prisma, workspace as any, {
      from: fromStr,
      to: toStr,
      groupBy: 'product',
      sort: 'cm1_total',
      dir: 'desc',
      page: 1,
      pageSize: 100,
    }),
    computeProducts(prisma, workspace as any, {
      from: priorFromStr,
      to: priorToStr,
      groupBy: 'product',
      sort: 'cm1_total',
      dir: 'desc',
      page: 1,
      pageSize: 100,
    }),
    getEffectiveDailyAggregates(prisma, connectionId, dateFrom, dateTo),
  ])

  const currentRows = currentResult.rows
  const priorRows = priorResult.rows

  // Build aggregate summaries
  const summary = buildSummaryFromRows(currentRows)
  const priorSummary = buildSummaryFromRows(priorRows)

  // Build daily time series for anomaly/trend detection
  const daily: CompressedDailyRow[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, d]) => ({
      date,
      revenue: Math.round(d.grossSales * 100) / 100,
      orders: d.ordersCount,
    }))

  // Top 8 hero products (positive CM1, sorted by cm1Total desc)
  const topProducts = currentRows
    .filter((r) => r.cm1Total > 0)
    .slice(0, 8)
    .map(compressProduct)

  // Bottom 5 margin destroyers (negative CM1, sorted by cm1Total asc)
  const bottomProducts = currentRows
    .filter((r) => r.cm1Total < 0)
    .sort((a, b) => a.cm1Total - b.cm1Total)
    .slice(0, 5)
    .map(compressProduct)

  // Top 5 high return rate products (min 5 orders to be meaningful)
  const highReturnProducts = [...currentRows]
    .filter((r) => r.orders >= 5 && r.returnRate > 0)
    .sort((a, b) => b.returnRate - a.returnRate)
    .slice(0, 5)
    .map(compressProduct)

  // Prior period top products for comparison
  const priorTopProducts = priorRows.slice(0, 8).map(compressProduct)

  return {
    page: 'products',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary,
    priorSummary,
    daily,
    currency: 'INR',
    extra: {
      topProducts,
      bottomProducts,
      highReturnProducts,
      priorTopProducts,
      totalProductsScanned: currentResult.totalRows,
    },
  }
}
