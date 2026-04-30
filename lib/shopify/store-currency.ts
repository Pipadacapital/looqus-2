import type { PrismaClient } from '@prisma/client'

/**
 * Resolve Shopify currency with range awareness.
 * Priority:
 * 1) order currency in active range
 * 2) analytics daily currency in active range
 * 3) latest order currency overall
 * 4) latest analytics daily currency overall
 * 5) fallback
 */
export async function getShopifyStoreCurrency(
  prisma: PrismaClient,
  connectionId: string,
  options?: {
    fromDate?: Date
    toDate?: Date
  },
  fallback = 'USD'
): Promise<string> {
  if (!connectionId) return fallback

  const rangeWhere =
    options?.fromDate && options?.toDate
      ? { processedAt: { gte: options.fromDate, lte: options.toDate } }
      : undefined
  const dailyRangeWhere =
    options?.fromDate && options?.toDate
      ? { date: { gte: options.fromDate, lte: options.toDate } }
      : undefined

  const [orderInRange, dailyInRange, latestOrder, latestDaily] = await Promise.all([
    prisma.shopifyOrder.findFirst({
      where: { connectionId, ...(rangeWhere ?? {}) },
      select: { currency: true },
      orderBy: { processedAt: 'desc' },
    }),
    prisma.shopifyAnalyticsDaily.findFirst({
      where: { connectionId, ...(dailyRangeWhere ?? {}) },
      select: { currency: true },
      orderBy: { date: 'desc' },
    }),
    prisma.shopifyOrder.findFirst({
      where: { connectionId },
      select: { currency: true },
      orderBy: { processedAt: 'desc' },
    }),
    prisma.shopifyAnalyticsDaily.findFirst({
      where: { connectionId },
      select: { currency: true },
      orderBy: { date: 'desc' },
    }),
  ])

  return (
    orderInRange?.currency?.trim() ||
    dailyInRange?.currency?.trim() ||
    latestOrder?.currency?.trim() ||
    latestDaily?.currency?.trim() ||
    fallback
  )
}
