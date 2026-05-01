import { prisma } from '@/lib/prisma'
import {
  extractWoocommerceOrderType,
  hasNoOrderFilters,
  type OrderFilterSettings,
} from '@/lib/order-filters'
import {
  fetchWoocommerceOrders,
  fetchWoocommerceOrderRefunds,
  fetchWoocommerceProducts,
  fetchWoocommerceProductVariations,
} from './woocommerce'

const ORDER_TYPE_BACKFILL_MAX = 5000

/**
 * Fills `order_type` from `raw_json` for rows still missing it (e.g. synced before column existed).
 */
export async function backfillWoocommerceOrderTypesFromRawJson(
  connectionId: string,
  options?: { maxUpdates?: number }
): Promise<{ updated: number }> {
  const maxUpdates = options?.maxUpdates ?? ORDER_TYPE_BACKFILL_MAX
  let updated = 0
  const batchSize = 400
  /** When a batch has no extractable order_type, advance past it to avoid an infinite loop. */
  let skip = 0

  while (updated < maxUpdates) {
    const rows = await prisma.woocommerceOrder.findMany({
      where: { connectionId, orderType: null },
      select: { id: true, rawJson: true },
      take: batchSize,
      skip,
      orderBy: { id: 'asc' },
    })
    if (rows.length === 0) break

    const toWrite: { id: string; orderType: string }[] = []
    for (const row of rows) {
      const t = extractWoocommerceOrderType(row.rawJson)
      if (t) toWrite.push({ id: row.id, orderType: t })
    }

    if (toWrite.length === 0) {
      skip += rows.length
      if (rows.length < batchSize) break
      continue
    }

    skip = 0
    const room = maxUpdates - updated
    const slice = toWrite.slice(0, room)
    await prisma.$transaction(
      slice.map((row) =>
        prisma.woocommerceOrder.update({
          where: { id: row.id },
          data: { orderType: row.orderType },
        })
      )
    )
    updated += slice.length

    if (rows.length < batchSize) break
  }

  return { updated }
}

/** When workspace order filters are active, backfill `order_type` from `raw_json` so inclusion checks are reliable. */
export async function ensureWooOrderTypesForOrderFilters(
  connectionId: string,
  settings: OrderFilterSettings,
  options?: { maxUpdates?: number }
): Promise<void> {
  if (hasNoOrderFilters(settings)) return
  await backfillWoocommerceOrderTypesFromRawJson(connectionId, options)
}

/**
 * Best-effort live lookup of Woo order_type values from Woo API.
 * Useful when DB rows were synced before order_type capture existed.
 */
export async function fetchLiveWoocommerceOrderTypeMap(
  connection: { storeUrl: string; consumerKey: string; consumerSecret: string },
  fromDate: Date,
  toDate: Date,
  options?: { maxPages?: number; lookbackDays?: number }
): Promise<Map<number, string>> {
  const maxPages = options?.maxPages ?? 10
  const lookbackDays = options?.lookbackDays ?? 3
  const out = new Map<number, string>()
  const recentAfter = new Date(fromDate)
  recentAfter.setUTCDate(recentAfter.getUTCDate() - lookbackDays)

  let page = 1
  let totalPages = 1
  do {
    const result = await fetchWoocommerceOrders(
      connection.storeUrl,
      connection.consumerKey,
      connection.consumerSecret,
      recentAfter,
      page
    )
    totalPages = result.totalPages
    for (const order of result.orders) {
      const createdAt = order?.date_created ? new Date(order.date_created) : null
      if (!createdAt || createdAt < fromDate || createdAt > toDate) continue
      const rawId = order?.id
      if (typeof rawId !== 'number') continue
      const typeVal = extractWoocommerceOrderType(order)
      if (typeVal) out.set(rawId, typeVal)
    }
    page += 1
  } while (page <= totalPages && page <= maxPages)

  return out
}

export async function syncWoocommerceForConnection(connectionId: string): Promise<{
  ordersUpserted: number
  lineItemsUpserted: number
  errors: number
  orderTypesBackfilled: number
}> {
  const connection = await prisma.woocommerceConnection.findUnique({
    where: { id: connectionId },
  })
  if (!connection) throw new Error(`WoocommerceConnection not found: ${connectionId}`)

  const { storeUrl, consumerKey, consumerSecret, lastSyncAt } = connection
  const after = lastSyncAt ?? undefined

  let ordersUpserted = 0
  let lineItemsUpserted = 0
  let errors = 0

  // --- Sync orders ---
  let page = 1
  let totalPages = 1

  do {
    let result: Awaited<ReturnType<typeof fetchWoocommerceOrders>>
    try {
      result = await fetchWoocommerceOrders(storeUrl, consumerKey, consumerSecret, after, page)
    } catch {
      errors++
      break
    }

    totalPages = result.totalPages

    if (page === 1 && result.orders.length > 0) {
      const detectedCurrency = result.orders[0]?.currency ?? null
      if (detectedCurrency && typeof detectedCurrency === 'string' && detectedCurrency.trim().length > 0) {
        await prisma.woocommerceConnection.update({
          where: { id: connectionId },
          data: { currency: detectedCurrency.trim() },
        })
      }
    }

    for (const order of result.orders) {
      try {
        let totalRefund = 0
        let productRefund = 0
        let shippingRefund = 0

        if (typeof order.id === 'number') {
          try {
            const refunds = await fetchWoocommerceOrderRefunds(
              storeUrl,
              consumerKey,
              consumerSecret,
              order.id
            )
            for (const r of refunds) {
              totalRefund += Math.abs(parseFloat(String((r as { total?: unknown }).total ?? '0')))
              const lineItems = Array.isArray((r as { line_items?: unknown }).line_items)
                ? (r as { line_items: unknown[] }).line_items
                : []
              for (const li of lineItems) {
                productRefund += Math.abs(parseFloat(String((li as { total?: unknown }).total ?? '0')))
              }
              const shippingLines = Array.isArray((r as { shipping_lines?: unknown }).shipping_lines)
                ? (r as { shipping_lines: unknown[] }).shipping_lines
                : []
              for (const sl of shippingLines) {
                shippingRefund += Math.abs(parseFloat(String((sl as { total?: unknown }).total ?? '0')))
              }
            }
          } catch {
            // Refund API can fail for some stores; keep order sync robust.
          }
        }
        if (productRefund === 0 && totalRefund > 0) {
          productRefund = Math.max(0, totalRefund - shippingRefund)
        }

        const orderData = {
          wcOrderId: order.id,
          orderNumber: String(order.number ?? order.id),
          status: order.status ?? null,
          currency: order.currency ?? null,
          total: order.total != null ? String(order.total) : null,
          subtotal: order.subtotal != null ? String(order.subtotal) : null,
          discountTotal: order.discount_total != null ? String(order.discount_total) : null,
          shippingTotal: order.shipping_total != null ? String(order.shipping_total) : null,
          totalTax: order.total_tax != null ? String(order.total_tax) : null,
          totalRefund: totalRefund > 0 ? String(totalRefund) : null,
          productRefund: productRefund > 0 ? String(productRefund) : null,
          shippingRefund: shippingRefund > 0 ? String(shippingRefund) : null,
          paymentMethod: order.payment_method ?? null,
          isCod: order.payment_method === 'cod',
          customerId: order.customer_id ?? null,
          customerEmail: order.billing?.email ?? null,
          customerPhone: order.billing?.phone ?? null,
          billingCity: order.billing?.city ?? null,
          billingPostcode: order.billing?.postcode ?? null,
          billingState: order.billing?.state ?? null,
          shippingCity: order.shipping?.city ?? null,
          shippingPostcode: order.shipping?.postcode ?? null,
          shippingState: order.shipping?.state ?? null,
          dateCreated: order.date_created ? new Date(order.date_created) : null,
          datePaid: order.date_paid ? new Date(order.date_paid) : null,
          orderType: extractWoocommerceOrderType(order),
          rawJson: order,
          syncedAt: new Date(),
        }

        const upserted = await prisma.woocommerceOrder.upsert({
          where: { connectionId_wcOrderId: { connectionId, wcOrderId: order.id } },
          create: { connectionId, ...orderData },
          update: orderData,
          select: { id: true },
        })

        ordersUpserted++

        // Replace line items (delete + insert)
        if (Array.isArray(order.line_items) && order.line_items.length > 0) {
          await prisma.woocommerceLineItem.deleteMany({
            where: { orderId: upserted.id },
          })

          const lineItemsData = order.line_items.map((li: any) => ({
            orderId: upserted.id,
            wcLineItemId: li.id,
            productId: li.product_id ?? null,
            variationId: li.variation_id ?? null,
            name: li.name ?? null,
            sku: li.sku ?? null,
            quantity: li.quantity ?? null,
            price: li.price != null ? String(li.price) : null,
            subtotal: li.subtotal != null ? String(li.subtotal) : null,
            total: li.total != null ? String(li.total) : null,
            rawJson: li,
          }))

          await prisma.woocommerceLineItem.createMany({ data: lineItemsData })
          lineItemsUpserted += lineItemsData.length
        }
      } catch {
        errors++
      }
    }

    page++
  } while (page <= totalPages)

  // --- Sync products ---
  page = 1
  totalPages = 1

  do {
    let result: Awaited<ReturnType<typeof fetchWoocommerceProducts>>
    try {
      result = await fetchWoocommerceProducts(storeUrl, consumerKey, consumerSecret, page)
    } catch {
      errors++
      break
    }

    totalPages = result.totalPages

    for (const product of result.products) {
      try {
        let resolvedSku: string | null = product.sku ?? null
        let resolvedStockQuantity: number | null =
          typeof product.stock_quantity === 'number' ? product.stock_quantity : null
        let resolvedRegularPrice: string | null = product.regular_price
          ? String(product.regular_price)
          : null
        let resolvedSalePrice: string | null = product.sale_price
          ? String(product.sale_price)
          : null

        if (product.type === 'variable' && typeof product.id === 'number') {
          const variations = await fetchWoocommerceProductVariations(
            storeUrl,
            consumerKey,
            consumerSecret,
            product.id
          )

          if (!resolvedSku) {
            const variationWithSku = variations.find(
              (variation: any) =>
                typeof variation?.sku === 'string' && variation.sku.trim().length > 0
            )
            resolvedSku = variationWithSku?.sku ?? null
          }

          if (resolvedStockQuantity == null) {
            const stockValues = variations
              .map((variation: any) => variation?.stock_quantity)
              .filter((value: unknown): value is number => typeof value === 'number')
            if (stockValues.length > 0) {
              resolvedStockQuantity = stockValues.reduce((sum, value) => sum + value, 0)
            }
          }

          if (!resolvedRegularPrice) {
            const regularPrices = variations
              .map((variation: any) => variation?.regular_price)
              .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
              .map((value: string) => Number(value))
              .filter((value: number) => Number.isFinite(value))
            if (regularPrices.length > 0) {
              resolvedRegularPrice = String(Math.min(...regularPrices))
            }
          }

          if (!resolvedSalePrice) {
            const salePrices = variations
              .map((variation: any) => variation?.sale_price)
              .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
              .map((value: string) => Number(value))
              .filter((value: number) => Number.isFinite(value))
            if (salePrices.length > 0) {
              resolvedSalePrice = String(Math.min(...salePrices))
            }
          }
        }

        if (resolvedStockQuantity == null && product.stock_status === 'outofstock') {
          resolvedStockQuantity = 0
        }

        const productData = {
          wcProductId: product.id,
          name: product.name ?? null,
          slug: product.slug ?? null,
          sku: resolvedSku,
          status: product.status ?? null,
          stockQuantity: resolvedStockQuantity,
          regularPrice: resolvedRegularPrice,
          salePrice: resolvedSalePrice,
          categories: product.categories ?? null,
          images: product.images ?? null,
          rawJson: product,
          syncedAt: new Date(),
        }

        await prisma.woocommerceProduct.upsert({
          where: { connectionId_wcProductId: { connectionId, wcProductId: product.id } },
          create: { connectionId, ...productData },
          update: productData,
        })
      } catch {
        errors++
      }
    }

    page++
  } while (page <= totalPages)

  // Update lastSyncAt
  await prisma.woocommerceConnection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date(), lastSyncError: errors > 0 ? `${errors} errors during sync` : null },
  })

  let orderTypesBackfilled = 0
  try {
    const bf = await backfillWoocommerceOrderTypesFromRawJson(connectionId, {
      maxUpdates: ORDER_TYPE_BACKFILL_MAX,
    })
    orderTypesBackfilled = bf.updated
  } catch {
    // Non-fatal: rows will get order_type on next successful sync/backfill.
  }

  return { ordersUpserted, lineItemsUpserted, errors, orderTypesBackfilled }
}
