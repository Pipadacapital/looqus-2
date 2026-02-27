import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'

/**
 * Aggregates Shopify orders into daily analytics and upserts into shopify_analytics_daily.
 * Uses already-synced orders (no Shopify API calls). Run after syncOrders.
 * Excludes cancelled orders from net sales and counts.
 */
export async function syncShopifyAnalyticsFromOrders(
  connectionId: string
): Promise<{ daysUpserted: number }> {
  const rows = await prisma.$queryRaw<
    Array<{
      connection_id: string
      date: Date
      net_sales: string
      gross_sales: string
      orders_count: bigint
      total_tax: string
      total_discount: string
      currency: string
    }>
  >(Prisma.sql`
    SELECT
      connection_id,
      DATE(processed_at) AS date,
      COALESCE(SUM(total_price), 0) AS net_sales,
      COALESCE(SUM(subtotal_price), 0) AS gross_sales,
      COUNT(*)::bigint AS orders_count,
      COALESCE(SUM(total_tax), 0) AS total_tax,
      COALESCE(SUM(total_discount), 0) AS total_discount,
      MAX(currency) AS currency
    FROM shopify_orders
    WHERE connection_id = (${connectionId})::uuid
      AND cancelled_at IS NULL
    GROUP BY connection_id, DATE(processed_at)
  `)

  let daysUpserted = 0
  for (const row of rows) {
    const ordersCount = Number(row.orders_count)
    const netSales = new Decimal(row.net_sales)
    const aov = ordersCount > 0 ? netSales.div(ordersCount) : new Decimal(0)

    await prisma.shopifyAnalyticsDaily.upsert({
      where: {
        connectionId_date: {
          connectionId,
          date: row.date,
        },
      },
      create: {
        connectionId,
        date: row.date,
        netSales: new Decimal(row.net_sales),
        grossSales: new Decimal(row.gross_sales),
        ordersCount,
        aov,
        totalTax: new Decimal(row.total_tax),
        totalDiscount: new Decimal(row.total_discount),
        currency: row.currency || 'USD',
      },
      update: {
        netSales: new Decimal(row.net_sales),
        grossSales: new Decimal(row.gross_sales),
        ordersCount,
        aov,
        totalTax: new Decimal(row.total_tax),
        totalDiscount: new Decimal(row.total_discount),
        currency: row.currency || 'USD',
      },
    })
    daysUpserted++
  }

  return { daysUpserted }
}
