/**
 * Shopify Bulk Operations – Database Processors
 *
 * Takes parsed JSONL rows from bulk operations and upserts them into
 * the existing Prisma models (ShopifyOrder, ShopifyLineItem, ShopifyProduct,
 * ShopifyVariant, ShopifyCustomer).
 *
 * Reuses the same DB schema and upsert logic as the paginated sync in
 * `lib/shopify/sync.ts`, but processes flat JSONL rows with __parentId
 * references instead of nested GraphQL edges.
 */

import { prisma } from '@/lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'
import type {
  BulkOrderRow,
  BulkLineItemRow,
  BulkProductRow,
  BulkVariantRow,
  BulkCustomerRow,
} from './types'

// ─── Utilities ─────────────────────────────────────────────────────────────────

function toDecimal(value: string | number | null | undefined): Decimal {
  if (value == null || value === '') return new Decimal(0)
  return new Decimal(String(value))
}

function parseGid(gid: string): string {
  return gid.replace(/^gid:\/\/shopify\/\w+\//, '')
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency)
    await Promise.allSettled(chunk.map((item) => worker(item)))
  }
}

function isTransientPrismaConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  return (
    message.includes('server has closed the connection') ||
    message.includes('connection') ||
    message.includes('pool')
  )
}

async function retryTransientDbError<T>(
  operation: () => Promise<T>,
  retries = 3
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      if (!isTransientPrismaConnectionError(error) || attempt === retries) {
        throw error
      }

      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Database operation failed after retries')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isOrderRow(row: any): row is BulkOrderRow {
  const id = row.id as string | undefined
  return !!id && id.includes('/Order/') && !row.__parentId
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isLineItemRow(row: any): row is BulkLineItemRow {
  const id = row.id as string | undefined
  return !!id && id.includes('/LineItem/') && !!row.__parentId
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isProductRow(row: any): row is BulkProductRow {
  const id = row.id as string | undefined
  return !!id && id.includes('/Product/') && !row.__parentId
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isVariantRow(row: any): row is BulkVariantRow {
  const id = row.id as string | undefined
  return !!id && id.includes('/ProductVariant/') && !!row.__parentId
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isCustomerRow(row: any): row is BulkCustomerRow {
  const id = row.id as string | undefined
  return !!id && id.includes('/Customer/') && !row.__parentId
}

// ─── Orders Processor ─────────────────────────────────────────────────────────

/**
 * Processes bulk JSONL rows for orders + line items.
 * In JSONL, order nodes and their line item children are interleaved.
 * Line items have `__parentId` pointing to their parent order GID.
 *
 * We collect them, then upsert in batches.
 */
export async function processOrderRows(
  connectionId: string,
  rows: Record<string, unknown>[]
): Promise<{ ordersProcessed: number; lineItemsProcessed: number }> {
  let ordersProcessed = 0
  let lineItemsProcessed = 0

  // First pass: collect order GID → DB record ID mapping
  // We need this because line items reference orders by Shopify GID
  const orderGidToDbId = new Map<string, string>()

  // Separate orders and line items
  const orderRows: BulkOrderRow[] = []
  const lineItemRows: BulkLineItemRow[] = []

  for (const row of rows) {
    if (isOrderRow(row)) {
      orderRows.push(row as BulkOrderRow)
    } else if (isLineItemRow(row)) {
      lineItemRows.push(row as BulkLineItemRow)
    }
  }

  console.log(
    `[BulkOps Processor] Processing ${orderRows.length} orders and ${lineItemRows.length} line items`
  )

  // Upsert orders in batches
  const ORDER_BATCH_SIZE = 100
  for (let i = 0; i < orderRows.length; i += ORDER_BATCH_SIZE) {
    const batch = orderRows.slice(i, i + ORDER_BATCH_SIZE)

    for (const order of batch) {
      const shopifyId = order.id
      const processedAt = order.processedAt ? new Date(order.processedAt) : new Date(0)
      const cancelledAt = order.cancelledAt ? new Date(order.cancelledAt) : null

      try {
        const orderRecord = await prisma.shopifyOrder.upsert({
          where: {
            connectionId_shopifyId: { connectionId, shopifyId },
          },
          create: {
            connectionId,
            shopifyId,
            orderNumber: parseGid(order.id),
            name: order.name,
            email: order.email ?? null,
            totalPrice: toDecimal(order.totalPriceSet?.shopMoney?.amount),
            subtotalPrice: toDecimal(order.subtotalPriceSet?.shopMoney?.amount),
            totalTax: toDecimal(order.totalTaxSet?.shopMoney?.amount),
            totalDiscount: toDecimal(order.totalDiscountsSet?.shopMoney?.amount),
            currency: order.currencyCode ?? 'USD',
            financialStatus: order.displayFinancialStatus ?? 'PENDING',
            fulfillmentStatus: order.displayFulfillmentStatus ?? null,
            customerShopifyId: order.customer?.id ?? null,
            processedAt,
            cancelledAt,
            tags: order.tags ?? [],
          },
          update: {
            totalPrice: toDecimal(order.totalPriceSet?.shopMoney?.amount),
            subtotalPrice: toDecimal(order.subtotalPriceSet?.shopMoney?.amount),
            totalTax: toDecimal(order.totalTaxSet?.shopMoney?.amount),
            totalDiscount: toDecimal(order.totalDiscountsSet?.shopMoney?.amount),
            financialStatus: order.displayFinancialStatus ?? 'PENDING',
            fulfillmentStatus: order.displayFulfillmentStatus ?? null,
            cancelledAt,
            tags: order.tags ?? [],
          },
        })

        orderGidToDbId.set(shopifyId, orderRecord.id)
        ordersProcessed++
      } catch (err) {
        console.error(
          `[BulkOps Processor] Failed to upsert order ${shopifyId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }

    if (i + ORDER_BATCH_SIZE < orderRows.length) {
      console.log(
        `[BulkOps Processor] Orders progress: ${Math.min(i + ORDER_BATCH_SIZE, orderRows.length)}/${orderRows.length}`
      )
    }
  }

  // Upsert line items
  const LINE_ITEM_BATCH_SIZE = 200
  for (let i = 0; i < lineItemRows.length; i += LINE_ITEM_BATCH_SIZE) {
    const batch = lineItemRows.slice(i, i + LINE_ITEM_BATCH_SIZE)

    for (const line of batch) {
      const parentOrderGid = line.__parentId
      const dbOrderId = orderGidToDbId.get(parentOrderGid)

      if (!dbOrderId) {
        // The parent order might already exist in DB from a previous sync
        const existingOrder = await prisma.shopifyOrder.findUnique({
          where: {
            connectionId_shopifyId: { connectionId, shopifyId: parentOrderGid },
          },
          select: { id: true },
        })
        if (existingOrder) {
          orderGidToDbId.set(parentOrderGid, existingOrder.id)
        } else {
          console.warn(
            `[BulkOps Processor] Skipping line item ${line.id}: parent order ${parentOrderGid} not found`
          )
          continue
        }
      }

      const orderId = orderGidToDbId.get(parentOrderGid)!
      const lineShopifyId = line.id
      const productGid = line.variant?.product?.id ?? null

      try {
        await prisma.shopifyLineItem.upsert({
          where: {
            connectionId_shopifyId: { connectionId, shopifyId: lineShopifyId },
          },
          create: {
            orderId,
            connectionId,
            shopifyId: lineShopifyId,
            title: line.title,
            quantity: line.quantity,
            price: toDecimal(line.originalUnitPriceSet?.shopMoney?.amount),
            sku: line.sku ?? null,
            variantTitle: line.variant?.title ?? null,
            productShopifyId: productGid,
          },
          update: {
            quantity: line.quantity,
            price: toDecimal(line.originalUnitPriceSet?.shopMoney?.amount),
            productShopifyId: productGid,
          },
        })
        lineItemsProcessed++
      } catch (err) {
        console.error(
          `[BulkOps Processor] Failed to upsert line item ${lineShopifyId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }

    if (i + LINE_ITEM_BATCH_SIZE < lineItemRows.length) {
      console.log(
        `[BulkOps Processor] Line items progress: ${Math.min(i + LINE_ITEM_BATCH_SIZE, lineItemRows.length)}/${lineItemRows.length}`
      )
    }
  }

  return { ordersProcessed, lineItemsProcessed }
}

// ─── Products Processor ────────────────────────────────────────────────────────

export async function processProductRows(
  connectionId: string,
  rows: Record<string, unknown>[]
): Promise<{ productsProcessed: number; variantsProcessed: number }> {
  let productsProcessed = 0
  let variantsProcessed = 0

  const productGidToDbId = new Map<string, string>()
  const productRows: BulkProductRow[] = []
  const variantRows: BulkVariantRow[] = []

  for (const row of rows) {
    if (isProductRow(row)) {
      productRows.push(row as BulkProductRow)
    } else if (isVariantRow(row)) {
      variantRows.push(row as BulkVariantRow)
    }
  }

  console.log(
    `[BulkOps Processor] Processing ${productRows.length} products and ${variantRows.length} variants`
  )

  // Upsert products
  const PRODUCT_BATCH_SIZE = 100
  for (let i = 0; i < productRows.length; i += PRODUCT_BATCH_SIZE) {
    const batch = productRows.slice(i, i + PRODUCT_BATCH_SIZE)

    for (const p of batch) {
      try {
        const productRecord = await prisma.shopifyProduct.upsert({
          where: {
            connectionId_shopifyId: { connectionId, shopifyId: p.id },
          },
          create: {
            connectionId,
            shopifyId: p.id,
            title: p.title,
            handle: p.handle,
            vendor: p.vendor ?? null,
            productType: p.productType ?? null,
            status: p.status,
            tags: p.tags ?? [],
            imageUrl: p.featuredImage?.url ?? null,
            totalInventory: p.totalInventory ?? null,
            publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
          },
          update: {
            title: p.title,
            handle: p.handle,
            vendor: p.vendor ?? null,
            productType: p.productType ?? null,
            status: p.status,
            tags: p.tags ?? [],
            imageUrl: p.featuredImage?.url ?? null,
            totalInventory: p.totalInventory ?? null,
            publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
          },
        })

        productGidToDbId.set(p.id, productRecord.id)
        productsProcessed++
      } catch (err) {
        console.error(
          `[BulkOps Processor] Failed to upsert product ${p.id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  // Upsert variants
  const VARIANT_BATCH_SIZE = 200
  for (let i = 0; i < variantRows.length; i += VARIANT_BATCH_SIZE) {
    const batch = variantRows.slice(i, i + VARIANT_BATCH_SIZE)

    for (const v of batch) {
      const parentProductGid = v.__parentId
      let dbProductId = productGidToDbId.get(parentProductGid)

      if (!dbProductId) {
        const existingProduct = await prisma.shopifyProduct.findUnique({
          where: {
            connectionId_shopifyId: { connectionId, shopifyId: parentProductGid },
          },
          select: { id: true },
        })
        if (existingProduct) {
          dbProductId = existingProduct.id
          productGidToDbId.set(parentProductGid, dbProductId)
        } else {
          console.warn(
            `[BulkOps Processor] Skipping variant ${v.id}: parent product ${parentProductGid} not found`
          )
          continue
        }
      }

      try {
        await prisma.shopifyVariant.upsert({
          where: {
            connectionId_shopifyId: { connectionId, shopifyId: v.id },
          },
          create: {
            connectionId,
            productId: dbProductId,
            shopifyId: v.id,
            title: v.title ?? null,
            sku: v.sku ?? null,
            price: v.price != null ? toDecimal(v.price) : null,
            compareAtPrice: v.compareAtPrice != null ? toDecimal(v.compareAtPrice) : null,
            inventoryQuantity: v.inventoryQuantity ?? null,
          },
          update: {
            productId: dbProductId,
            title: v.title ?? null,
            sku: v.sku ?? null,
            price: v.price != null ? toDecimal(v.price) : null,
            compareAtPrice: v.compareAtPrice != null ? toDecimal(v.compareAtPrice) : null,
            inventoryQuantity: v.inventoryQuantity ?? null,
          },
        })
        variantsProcessed++
      } catch (err) {
        console.error(
          `[BulkOps Processor] Failed to upsert variant ${v.id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  return { productsProcessed, variantsProcessed }
}

// ─── Customers Processor ──────────────────────────────────────────────────────

export async function processCustomerRows(
  connectionId: string,
  rows: Record<string, unknown>[]
): Promise<{ customersProcessed: number }> {
  let customersProcessed = 0

  const customerRows: BulkCustomerRow[] = []
  for (const row of rows) {
    if (isCustomerRow(row)) {
      customerRows.push(row as BulkCustomerRow)
    }
  }

  console.log(`[BulkOps Processor] Processing ${customerRows.length} customers`)

  const CUSTOMER_BATCH_SIZE = 100
  const CUSTOMER_UPSERT_CONCURRENCY = 8
  for (let i = 0; i < customerRows.length; i += CUSTOMER_BATCH_SIZE) {
    const batch = customerRows.slice(i, i + CUSTOMER_BATCH_SIZE)

    await runWithConcurrency(
      batch,
      CUSTOMER_UPSERT_CONCURRENCY,
      async (c) => {
        try {
          await retryTransientDbError(() =>
            prisma.shopifyCustomer.upsert({
              where: {
                connectionId_shopifyId: { connectionId, shopifyId: c.id },
              },
              create: {
                connectionId,
                shopifyId: c.id,
                email: c.email ?? null,
                firstName: c.firstName ?? null,
                lastName: c.lastName ?? null,
                ordersCount: Number(c.numberOfOrders) || 0,
                totalSpent: toDecimal(c.amountSpent?.amount),
                currency: null,
                tags: c.tags ?? [],
                state: c.state ?? null,
                shopifyCreatedAt: new Date(c.createdAt),
              },
              update: {
                email: c.email ?? null,
                firstName: c.firstName ?? null,
                lastName: c.lastName ?? null,
                ordersCount: Number(c.numberOfOrders) || 0,
                totalSpent: toDecimal(c.amountSpent?.amount),
                currency: null,
                tags: c.tags ?? [],
                state: c.state ?? null,
              },
            })
          )
          customersProcessed++
        } catch (err) {
          console.error(
            `[BulkOps Processor] Failed to upsert customer ${c.id}:`,
            err instanceof Error ? err.message : err
          )
        }
      }
    )

    if (i + CUSTOMER_BATCH_SIZE < customerRows.length) {
      console.log(
        `[BulkOps Processor] Customers progress: ${Math.min(i + CUSTOMER_BATCH_SIZE, customerRows.length)}/${customerRows.length}`
      )
    }
  }

  return { customersProcessed }
}
