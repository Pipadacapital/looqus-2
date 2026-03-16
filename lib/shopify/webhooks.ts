import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { shopifyGraphQL } from './graphql'
import { Decimal } from '@prisma/client/runtime/library'

const SHOPIFY_API_VERSION = '2025-01'

/** Topics we subscribe to for real-time data (GraphQL enum values) */
export const WEBHOOK_TOPICS = [
  'ORDERS_CREATE',
  'ORDERS_UPDATED',
  'ORDERS_CANCELLED',
  'ORDERS_DELETE',
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
  'CUSTOMERS_CREATE',
  'CUSTOMERS_UPDATE',
  'INVENTORY_LEVELS_UPDATE',
] as const

export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number]

/** Shopify sends X-Shopify-Hmac-SHA256 with HMAC-SHA256 of raw body using client secret */
export function verifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
  clientSecret: string
): boolean {
  if (!hmacHeader) return false
  const computed = crypto
    .createHmac('sha256', clientSecret)
    .update(rawBody, 'utf8')
    .digest('base64')
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmacHeader, 'base64'),
      Buffer.from(computed, 'base64')
    )
  } catch {
    return false
  }
}

function toDecimal(value: string | number | null | undefined): Decimal {
  if (value == null || value === '') return new Decimal(0)
  return new Decimal(String(value))
}

/** REST webhook order payload (subset we use) */
type RestLineItem = {
  id?: number
  admin_graphql_api_id?: string
  title?: string
  quantity?: number
  price?: string
  sku?: string | null
  variant_title?: string | null
  product_id?: number | null
}
type RestOrder = {
  id?: number
  admin_graphql_api_id?: string
  name?: string
  email?: string | null
  total_price?: string
  subtotal_price?: string
  total_tax?: string
  total_discounts?: string
  currency?: string
  financial_status?: string
  fulfillment_status?: string | null
  customer?: { id?: number } | null
  processed_at?: string | null
  cancelled_at?: string | null
  line_items?: RestLineItem[]
  tags?: string | string[]
}

function orderShopifyId(order: RestOrder): string {
  if (order.admin_graphql_api_id) return order.admin_graphql_api_id
  return `gid://shopify/Order/${order.id ?? 0}`
}

function lineItemShopifyId(li: RestLineItem): string {
  if (li?.admin_graphql_api_id) return li.admin_graphql_api_id
  return `gid://shopify/LineItem/${li?.id ?? 0}`
}

function productGid(li: RestLineItem): string | null {
  if (li?.product_id == null) return null
  return `gid://shopify/Product/${li.product_id}`
}

export async function handleOrderWebhook(
  connectionId: string,
  payload: RestOrder
): Promise<void> {
  const shopifyId = orderShopifyId(payload)
  const processedAt = payload.processed_at
    ? new Date(payload.processed_at)
    : new Date(0)
  const cancelledAt = payload.cancelled_at
    ? new Date(payload.cancelled_at)
    : null
  const tags = Array.isArray(payload.tags)
    ? payload.tags
    : typeof payload.tags === 'string'
      ? payload.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : []

  const orderRecord = await prisma.shopifyOrder.upsert({
    where: {
      connectionId_shopifyId: { connectionId, shopifyId },
    },
    create: {
      connectionId,
      shopifyId,
      orderNumber: String(payload.id ?? shopifyId.replace(/^gid:\/\/shopify\/Order\//, '')),
      name: payload.name ?? '',
      email: payload.email ?? null,
      totalPrice: toDecimal(payload.total_price),
      subtotalPrice: toDecimal(payload.subtotal_price),
      totalTax: toDecimal(payload.total_tax),
      totalDiscount: toDecimal(payload.total_discounts),
      currency: payload.currency ?? 'USD',
      financialStatus: payload.financial_status ?? 'PENDING',
      fulfillmentStatus: payload.fulfillment_status ?? null,
      customerShopifyId: payload.customer?.id
        ? `gid://shopify/Customer/${payload.customer.id}`
        : null,
      processedAt,
      cancelledAt,
      tags,
    },
    update: {
      totalPrice: toDecimal(payload.total_price),
      subtotalPrice: toDecimal(payload.subtotal_price),
      totalTax: toDecimal(payload.total_tax),
      totalDiscount: toDecimal(payload.total_discounts),
      financialStatus: payload.financial_status ?? 'PENDING',
      fulfillmentStatus: payload.fulfillment_status ?? null,
      cancelledAt,
      tags,
    },
  })

  for (const li of payload.line_items ?? []) {
    const lineShopifyId = lineItemShopifyId(li)
    await prisma.shopifyLineItem.upsert({
      where: {
        connectionId_shopifyId: { connectionId, shopifyId: lineShopifyId },
      },
      create: {
        orderId: orderRecord.id,
        connectionId,
        shopifyId: lineShopifyId,
        title: li.title ?? '',
        quantity: li.quantity ?? 0,
        price: toDecimal(li.price),
        sku: li.sku ?? null,
        variantTitle: li.variant_title ?? null,
        productShopifyId: productGid(li),
      },
      update: {
        quantity: li.quantity ?? 0,
        price: toDecimal(li.price),
        productShopifyId: productGid(li),
      },
    })
  }
}

/** REST product webhook payload */
type RestVariant = {
  id?: number
  admin_graphql_api_id?: string
  title?: string | null
  sku?: string | null
  price?: string | null
  compare_at_price?: string | null
  inventory_quantity?: number | null
}
type RestProduct = {
  id?: number
  admin_graphql_api_id?: string
  title?: string
  handle?: string
  vendor?: string | null
  product_type?: string | null
  status?: string
  tags?: string | string[]
  images?: Array<{ src?: string }>
  total_inventory?: number | null
  published_at?: string | null
  variants?: RestVariant[]
}

function productShopifyId(p: RestProduct): string {
  if (p.admin_graphql_api_id) return p.admin_graphql_api_id
  return `gid://shopify/Product/${p.id ?? 0}`
}

function variantShopifyId(v: RestVariant): string {
  if (v?.admin_graphql_api_id) return v.admin_graphql_api_id
  return `gid://shopify/ProductVariant/${v?.id ?? 0}`
}

export async function handleProductWebhook(
  connectionId: string,
  payload: RestProduct
): Promise<void> {
  const shopifyId = productShopifyId(payload)
  const tags = Array.isArray(payload.tags)
    ? payload.tags
    : typeof payload.tags === 'string'
      ? payload.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : []
  const imageUrl = payload.images?.[0]?.src ?? null

  const productRecord = await prisma.shopifyProduct.upsert({
    where: {
      connectionId_shopifyId: { connectionId, shopifyId },
    },
    create: {
      connectionId,
      shopifyId,
      title: payload.title ?? '',
      handle: payload.handle ?? String(payload.id),
      vendor: payload.vendor ?? null,
      productType: payload.product_type ?? null,
      status: payload.status ?? 'active',
      tags,
      imageUrl,
      totalInventory: payload.total_inventory ?? null,
      publishedAt: payload.published_at
        ? new Date(payload.published_at)
        : null,
    },
    update: {
      title: payload.title ?? '',
      handle: payload.handle ?? String(payload.id),
      vendor: payload.vendor ?? null,
      productType: payload.product_type ?? null,
      status: payload.status ?? 'active',
      tags,
      imageUrl,
      totalInventory: payload.total_inventory ?? null,
      publishedAt: payload.published_at
        ? new Date(payload.published_at)
        : null,
    },
  })

  for (const v of payload.variants ?? []) {
    await prisma.shopifyVariant.upsert({
      where: {
        connectionId_shopifyId: { connectionId, shopifyId: variantShopifyId(v) },
      },
      create: {
        connectionId,
        productId: productRecord.id,
        shopifyId: variantShopifyId(v),
        title: v.title ?? null,
        sku: v.sku ?? null,
        price: v.price != null ? toDecimal(v.price) : null,
        compareAtPrice:
          v.compare_at_price != null ? toDecimal(v.compare_at_price) : null,
        inventoryQuantity: v.inventory_quantity ?? null,
      },
      update: {
        title: v.title ?? null,
        sku: v.sku ?? null,
        price: v.price != null ? toDecimal(v.price) : null,
        compareAtPrice:
          v.compare_at_price != null ? toDecimal(v.compare_at_price) : null,
        inventoryQuantity: v.inventory_quantity ?? null,
      },
    })
  }
}

export async function handleProductDeleteWebhook(
  connectionId: string,
  payload: { id?: number; admin_graphql_api_id?: string }
): Promise<void> {
  const shopifyId =
    payload.admin_graphql_api_id ?? `gid://shopify/Product/${payload.id ?? 0}`
  await prisma.shopifyProduct.deleteMany({
    where: { connectionId, shopifyId },
  })
}

/** Delete order and its line items when Shopify sends orders/delete */
export async function handleOrderDeleteWebhook(
  connectionId: string,
  payload: { id?: number; admin_graphql_api_id?: string }
): Promise<void> {
  const shopifyId =
    payload.admin_graphql_api_id ?? `gid://shopify/Order/${payload.id ?? 0}`
  await prisma.shopifyOrder.deleteMany({
    where: { connectionId, shopifyId },
  })
}

/** REST customer webhook payload */
type RestCustomer = {
  id?: number
  admin_graphql_api_id?: string
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  orders_count?: number
  total_spent?: string
  currency?: string | null
  tags?: string | string[]
  state?: string | null
  created_at?: string | null
}

function customerShopifyId(c: RestCustomer): string {
  if (c.admin_graphql_api_id) return c.admin_graphql_api_id
  return `gid://shopify/Customer/${c.id ?? 0}`
}

export async function handleCustomerWebhook(
  connectionId: string,
  payload: RestCustomer
): Promise<void> {
  const shopifyId = customerShopifyId(payload)
  const tags = Array.isArray(payload.tags)
    ? payload.tags
    : typeof payload.tags === 'string'
      ? payload.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : []

  await prisma.shopifyCustomer.upsert({
    where: {
      connectionId_shopifyId: { connectionId, shopifyId },
    },
    create: {
      connectionId,
      shopifyId,
      email: payload.email ?? null,
      firstName: payload.first_name ?? null,
      lastName: payload.last_name ?? null,
      ordersCount: payload.orders_count ?? 0,
      totalSpent: toDecimal(payload.total_spent),
      currency: payload.currency ?? null,
      tags,
      state: payload.state ?? null,
      shopifyCreatedAt: payload.created_at ? new Date(payload.created_at) : null,
    },
    update: {
      email: payload.email ?? null,
      firstName: payload.first_name ?? null,
      lastName: payload.last_name ?? null,
      ordersCount: payload.orders_count ?? 0,
      totalSpent: toDecimal(payload.total_spent),
      currency: payload.currency ?? null,
      tags,
      state: payload.state ?? null,
    },
  })
}

/** REST inventory_level webhook – we need to find variant by inventory_item_id and update quantity */
type RestInventoryLevel = {
  inventory_item_id?: number
  location_id?: number
  available?: number
}

const INVENTORY_ITEM_VARIANT_QUERY = `
  query GetVariantByInventoryItem($id: ID!) {
    inventoryItem(id: $id) {
      variant {
        id
      }
    }
  }
`

export async function handleInventoryLevelWebhook(
  connectionId: string,
  payload: RestInventoryLevel
): Promise<void> {
  if (payload.inventory_item_id == null || payload.available == null) return
  const conn = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: { shopDomain: true, accessToken: true },
  })
  if (!conn?.accessToken) return

  const gid = `gid://shopify/InventoryItem/${payload.inventory_item_id}`
  const data = await shopifyGraphQL<{
    inventoryItem: { variant: { id: string } | null } | null
  }>({
    shopDomain: conn.shopDomain,
    accessToken: conn.accessToken,
    query: INVENTORY_ITEM_VARIANT_QUERY,
    variables: { id: gid },
  })
  const variantGid = data.inventoryItem?.variant?.id
  if (!variantGid) return

  await prisma.shopifyVariant.updateMany({
    where: { connectionId, shopifyId: variantGid },
    data: { inventoryQuantity: payload.available },
  })
}

/** Map Shopify webhook topic header (e.g. orders/create) to our topic enum */
export function parseWebhookTopic(
  topicHeader: string | null
): WebhookTopic | null {
  if (!topicHeader) return null
  const normalized = topicHeader.toUpperCase().replace(/\//g, '_')
  if (WEBHOOK_TOPICS.includes(normalized as WebhookTopic)) {
    return normalized as WebhookTopic
  }
  // Shopify may send "orders/create" -> ORDERS_CREATE
  const mapped: Record<string, WebhookTopic> = {
    ORDERS_CREATE: 'ORDERS_CREATE',
    ORDERS_UPDATED: 'ORDERS_UPDATED',
    ORDERS_CANCELLED: 'ORDERS_CANCELLED',
    ORDERS_DELETE: 'ORDERS_DELETE',
    PRODUCTS_CREATE: 'PRODUCTS_CREATE',
    PRODUCTS_UPDATE: 'PRODUCTS_UPDATE',
    PRODUCTS_DELETE: 'PRODUCTS_DELETE',
    CUSTOMERS_CREATE: 'CUSTOMERS_CREATE',
    CUSTOMERS_UPDATE: 'CUSTOMERS_UPDATE',
    INVENTORY_LEVELS_UPDATE: 'INVENTORY_LEVELS_UPDATE',
  }
  return mapped[normalized] ?? null
}

/** GraphQL topic names for webhookSubscriptionCreate (must match Shopify enum) */
export const WEBHOOK_TOPIC_GRAPHQL: Record<WebhookTopic, string> = {
  ORDERS_CREATE: 'ORDERS_CREATE',
  ORDERS_UPDATED: 'ORDERS_UPDATED',
  ORDERS_CANCELLED: 'ORDERS_CANCELLED',
  ORDERS_DELETE: 'ORDERS_DELETE',
  PRODUCTS_CREATE: 'PRODUCTS_CREATE',
  PRODUCTS_UPDATE: 'PRODUCTS_UPDATE',
  PRODUCTS_DELETE: 'PRODUCTS_DELETE',
  CUSTOMERS_CREATE: 'CUSTOMERS_CREATE',
  CUSTOMERS_UPDATE: 'CUSTOMERS_UPDATE',
  INVENTORY_LEVELS_UPDATE: 'INVENTORY_LEVELS_UPDATE',
}

const WEBHOOK_SUBSCRIPTION_CREATE = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
        topic
        endpoint { ... on WebhookHttpEndpoint { callbackUrl } }
      }
      userErrors {
        field
        message
      }
    }
  }
`

/** Register all webhook subscriptions for a connected shop. Call after OAuth. */
export async function registerWebhooks(
  shopDomain: string,
  accessToken: string
): Promise<{ registered: number; errors: string[] }> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!baseUrl) {
    return { registered: 0, errors: ['NEXT_PUBLIC_APP_URL is not set'] }
  }
  const webhookUri = `${baseUrl.replace(/\/$/, '')}/api/shopify/webhooks`
  const errors: string[] = []
  let registered = 0

  for (const topic of WEBHOOK_TOPICS) {
    const graphqlTopic = WEBHOOK_TOPIC_GRAPHQL[topic]
    try {
      const data = await shopifyGraphQL<{
        webhookSubscriptionCreate?: {
          webhookSubscription?: { id: string; topic: string }
          userErrors?: Array<{ field: string[]; message: string }>
        }
      }>({
        shopDomain,
        accessToken,
        query: WEBHOOK_SUBSCRIPTION_CREATE,
        variables: {
          topic: graphqlTopic,
          webhookSubscription: {
            uri: webhookUri,
            format: 'JSON',
          },
        },
      })
      const result = data.webhookSubscriptionCreate
      if (result?.userErrors?.length) {
        errors.push(`${topic}: ${result.userErrors.map((e) => e.message).join('; ')}`)
      } else if (result?.webhookSubscription?.id) {
        registered++
      }
    } catch (err) {
      errors.push(`${topic}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { registered, errors }
}
