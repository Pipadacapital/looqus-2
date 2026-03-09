/**
 * Shopify Refund Line Item Sync
 *
 * Source of truth for product/variant-level returned quantity and refund amount:
 * Order -> refunds -> refundLineItems (refund line item maps back to original
 * line item via lineItem.id for product/variant attribution).
 *
 * GraphQL query (OrdersWithRefunds) fetches:
 * - orders: id (order GID)
 * - refunds: id, processedAt
 * - refundLineItems: id, quantity, subtotalSet.shopMoney.amount,
 *   totalTaxSet.shopMoney.amount, lineItem.id (original line item GID)
 *
 * Persisted to shopify_refund_line_items: connectionId, shopifyRefundId,
 * shopifyRefundLineId, shopifyOrderId, orderId, shopifyLineItemId, lineItemId
 * (resolved from lineItem.id), productShopifyId and sku (from line item when
 * found), quantity, subtotalAmount, totalTaxAmount, processedAt.
 */

import { prisma } from '@/lib/prisma'
import { shopifyGraphQL } from '@/lib/shopify/graphql'
import { Decimal } from '@prisma/client/runtime/library'

const REFUNDS_ORDER_QUERY = `
  query OrdersWithRefunds($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          refunds(first: 50) {
            id
            processedAt
            refundLineItems(first: 100) {
              edges {
                node {
                  id
                  quantity
                  subtotalSet { shopMoney { amount currencyCode } }
                  totalTaxSet { shopMoney { amount currencyCode } }
                  lineItem { id }
                }
              }
            }
          }
        }
      }
    }
  }
`

type OrdersWithRefundsResponse = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    edges: Array<{
      node: {
        id: string
        refunds: Array<{
          id: string
          processedAt: string
          refundLineItems: {
            edges: Array<{
              node: {
                id: string
                quantity: number
                subtotalSet: { shopMoney: { amount: string; currencyCode: string } }
                totalTaxSet: { shopMoney: { amount: string; currencyCode: string } }
                lineItem: { id: string }
              }
            }>
          }
        }>
      }
    }>
  }
}

function toDecimal(value: string | number | null | undefined): Decimal {
  if (value == null || value === '') return new Decimal(0)
  return new Decimal(String(value))
}

export type SyncRefundsParams = {
  connectionId: string
  shopDomain: string
  accessToken: string
  fromDate: Date
  toDate: Date
}

export type SyncRefundsResult = {
  ordersFetched: number
  refundLinesUpserted: number
  refundLinesUnmapped: number
  errors: string[]
}

/**
 * Sync refund line items from Shopify for the given connection and date range.
 * Upserts into shopify_refund_line_items. Resolves orderId and lineItemId from
 * existing shopify_orders and shopify_line_items by Shopify GID.
 * If a refund line's lineItem cannot be found in DB, we still persist the row
 * with orderId (resolved from order), lineItemId and productShopifyId null;
 * such rows are logged as unmapped and Products page can treat them as fallback.
 */
export async function syncRefunds(params: SyncRefundsParams): Promise<SyncRefundsResult> {
  const { connectionId, shopDomain, accessToken, fromDate, toDate } = params
  const fromStr = fromDate.toISOString().slice(0, 10)
  const toStr = toDate.toISOString().slice(0, 10)
  const query = `processed_at:>=${fromStr} AND processed_at:<=${toStr}`

  let ordersFetched = 0
  let refundLinesUpserted = 0
  let refundLinesUnmapped = 0
  const errors: string[] = []
  const ORDER_PAGE_SIZE = 50

  let cursor: string | null = null

  for (;;) {
    const data: OrdersWithRefundsResponse = await shopifyGraphQL({
      shopDomain,
      accessToken,
      query: REFUNDS_ORDER_QUERY,
      variables: {
        query,
        first: ORDER_PAGE_SIZE, 
        after: cursor,
      },
    })

    const orders = data.orders
    const edges = orders.edges ?? []
    if (edges.length === 0 && ordersFetched === 0) {
      break
    }

    for (const edge of edges) {
      const orderNode = edge.node
      const orderShopifyId = orderNode.id

      const ourOrder = await prisma.shopifyOrder.findUnique({
        where: {
          connectionId_shopifyId: { connectionId, shopifyId: orderShopifyId },
        },
        select: { id: true },
      })

      if (!ourOrder) {
        errors.push(`Order ${orderShopifyId} not found in DB, skipping refunds`)
        continue
      }

      ordersFetched++

      for (const refund of orderNode.refunds ?? []) {
        const refundLineItems = refund.refundLineItems?.edges ?? []
        const processedAt = refund.processedAt ? new Date(refund.processedAt) : new Date()

        for (const rliEdge of refundLineItems) {
          const rli = rliEdge.node
          const lineItemShopifyId = rli.lineItem?.id ?? null
          const quantity = rli.quantity ?? 0
          const subtotalAmount = toDecimal(rli.subtotalSet?.shopMoney?.amount)
          const totalTaxAmount = toDecimal(rli.totalTaxSet?.shopMoney?.amount)

          let lineItemId: string | null = null
          let productShopifyId: string | null = null
          let sku: string | null = null

          if (lineItemShopifyId) {
            const ourLine = await prisma.shopifyLineItem.findUnique({
              where: {
                connectionId_shopifyId: { connectionId, shopifyId: lineItemShopifyId },
              },
              select: { id: true, productShopifyId: true, sku: true },
            })
            if (ourLine) {
              lineItemId = ourLine.id
              productShopifyId = ourLine.productShopifyId
              sku = ourLine.sku
            } else {
              refundLinesUnmapped++
              if (process.env.NODE_ENV === 'development') {
                console.warn(
                  `[RefundSync] Refund line ${rli.id} references lineItem ${lineItemShopifyId} not found in DB`
                )
              }
            }
          } else {
            refundLinesUnmapped++
          }

          try {
            await prisma.shopify_refund_line_items.upsert({
              where: {
                connection_id_shopify_refund_line_id: {
                  connection_id: connectionId,
                  shopify_refund_line_id: rli.id,
                },
              },
              create: {
                connection_id: connectionId,
                shopify_refund_id: refund.id,
                shopify_refund_line_id: rli.id,
                shopify_order_id: orderShopifyId,
                order_id: ourOrder.id,
                shopify_line_item_id: lineItemShopifyId,
                line_item_id: lineItemId,
                product_shopify_id: productShopifyId,
                sku,
                quantity,
                subtotal_amount: subtotalAmount,
                total_tax_amount: totalTaxAmount,
                processed_at: processedAt,
              },
              update: {
                quantity,
                subtotal_amount: subtotalAmount,
                total_tax_amount: totalTaxAmount,
                processed_at: processedAt,
                line_item_id: lineItemId,
                product_shopify_id: productShopifyId,
                sku,
              },
            })
            refundLinesUpserted++
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            errors.push(`Upsert refund line ${rli.id}: ${msg}`)
          }
        }
      }
    }

    if (!orders.pageInfo.hasNextPage || !orders.pageInfo.endCursor) {
      break
    }
    cursor = orders.pageInfo.endCursor
  }

  return {
    ordersFetched,
    refundLinesUpserted,
    refundLinesUnmapped,
    errors,
  }
}
