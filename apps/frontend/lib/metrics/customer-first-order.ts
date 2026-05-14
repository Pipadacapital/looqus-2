/**
 * First-order / "new customer in window" resolution for a Shopify connection.
 *
 * A row = customer whose first included order falls in [fromDate, toDate] (inclusive end per caller).
 * With workspace order filters: first order is computed only among included orders (tags, zero-sales).
 * Without filters: first order is global min(processed_at) per customer; tie-break by smallest order id.
 */

import type { PrismaClient } from '@prisma/client'
import {
  getOrderInclusionWhere,
  hasNoOrderFilters,
  type OrderFilterSettings,
} from '@/lib/order-filters'

export type CustomerFirstOrderRow = {
  customer_shopify_id: string
  first_at: Date
  order_id: string
}

function pickEarlierOrder(
  a: { firstAt: Date; orderId: string },
  b: { firstAt: Date; orderId: string }
): { firstAt: Date; orderId: string } {
  const ta = a.firstAt.getTime()
  const tb = b.firstAt.getTime()
  if (ta < tb) return a
  if (tb < ta) return b
  return a.orderId < b.orderId ? a : b
}

/**
 * Customers whose first qualifying order processed date is within [fromDate, toDate].
 */
export async function fetchCustomerFirstOrdersInRange(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  orderFilterSettings: OrderFilterSettings
): Promise<CustomerFirstOrderRow[]> {
  if (!hasNoOrderFilters(orderFilterSettings)) {
    const inclusionWhere = getOrderInclusionWhere(orderFilterSettings)
    const orders = await prisma.shopifyOrder.findMany({
      where: {
        connectionId,
        customerShopifyId: { not: null, notIn: [''] },
        processedAt: { lte: toDate },
        ...inclusionWhere,
      },
      select: { id: true, customerShopifyId: true, processedAt: true },
    })
    const firstByCustomer = new Map<string, { firstAt: Date; orderId: string }>()
    for (const o of orders) {
      const cid = o.customerShopifyId
      if (!cid) continue
      const cur = { firstAt: o.processedAt, orderId: o.id }
      const existing = firstByCustomer.get(cid)
      firstByCustomer.set(cid, existing ? pickEarlierOrder(existing, cur) : cur)
    }
    return [...firstByCustomer.entries()]
      .filter(([, v]) => v.firstAt >= fromDate && v.firstAt <= toDate)
      .map(([customer_shopify_id, v]) => ({
        customer_shopify_id,
        first_at: v.firstAt,
        order_id: v.orderId,
      }))
  }

  const rows = await prisma.$queryRaw<CustomerFirstOrderRow[]>`
    WITH ranked AS (
      SELECT
        customer_shopify_id,
        processed_at AS first_at,
        id AS order_id,
        ROW_NUMBER() OVER (
          PARTITION BY customer_shopify_id
          ORDER BY processed_at ASC, id ASC
        ) AS rn
      FROM shopify_orders
      WHERE connection_id = ${connectionId}::uuid
        AND customer_shopify_id IS NOT NULL
        AND customer_shopify_id != ''
    )
    SELECT customer_shopify_id, first_at, order_id
    FROM ranked
    WHERE rn = 1
      AND first_at >= ${fromDate}
      AND first_at <= ${toDate}
  `
  return rows
}
