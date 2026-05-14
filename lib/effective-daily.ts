/**
 * Effective daily aggregates: merge shopify_analytics_daily with order-derived fallback
 * for dates that have orders but no analytics row (e.g. ShopifyQL reporting lag).
 *
 * Used by: P&L (inline), products, LTV, cohorts, acquisition, distributions (via products).
 * Ensures recent-date metrics are filled from raw orders when analytics daily is incomplete.
 */

import type { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'

export type EffectiveDailyRow = {
  ordersCount: number
  grossSales: number
  totalReturns: number
}

/**
 * Returns a map of date string (yyyy-MM-dd) -> daily aggregates.
 * For each date: uses shopify_analytics_daily when present; otherwise derives from
 * orders in range (ordersCount, grossSales; totalReturns = 0 when order-derived).
 * Respects orderInclusionWhere when provided (workspace order filters).
 */
export async function getEffectiveDailyAggregates(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  orderInclusionWhere?: Prisma.ShopifyOrderWhereInput
): Promise<Map<string, EffectiveDailyRow>> {
  const [analyticsRows, orders] = await Promise.all([
    prisma.shopifyAnalyticsDaily.findMany({
      where: { connectionId, date: { gte: fromDate, lte: toDate } },
      select: { date: true, ordersCount: true, grossSales: true, total_returns: true },
    }),
    prisma.shopifyOrder.findMany({
      where: {
        connectionId,
        processedAt: { gte: fromDate, lte: toDate },
        cancelledAt: null,
        ...orderInclusionWhere,
      },
      select: { processedAt: true, totalPrice: true },
    }),
  ])

  const map = new Map<string, EffectiveDailyRow>()

  for (const d of analyticsRows) {
    const dateStr = d.date.toISOString().slice(0, 10)
    map.set(dateStr, {
      ordersCount: d.ordersCount,
      grossSales: Number(d.grossSales),
      totalReturns: Math.max(0, Number(d.total_returns ?? 0)),
    })
  }

  const orderByDate = new Map<string, { count: number; gross: number }>()
  for (const o of orders) {
    const dateStr = o.processedAt.toISOString().slice(0, 10)
    const cur = orderByDate.get(dateStr) ?? { count: 0, gross: 0 }
    cur.count += 1
    cur.gross += Number(o.totalPrice)
    orderByDate.set(dateStr, cur)
  }

  for (const [dateStr, agg] of orderByDate) {
    if (!map.has(dateStr)) {
      map.set(dateStr, {
        ordersCount: agg.count,
        grossSales: agg.gross,
        totalReturns: 0,
      })
    }
  }

  return map
}
