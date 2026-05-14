import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  verifyWebhookHmac,
  parseWebhookTopic,
  handleOrderWebhook,
  handleOrderDeleteWebhook,
  handleProductWebhook,
  handleProductDeleteWebhook,
  handleCustomerWebhook,
  handleInventoryLevelWebhook,
  handleAppUninstalled,
} from '@/lib/shopify/webhooks'

/** Shopify sends POST with X-Shopify-Shop-Domain, X-Shopify-Hmac-SHA256, X-Shopify-Topic, raw JSON body */
export async function POST(request: NextRequest) {
  const shopDomain = request.headers.get('x-shopify-shop-domain')
  const hmac = request.headers.get('x-shopify-hmac-sha256')
  const topicHeader = request.headers.get('x-shopify-topic')

  if (!shopDomain || !topicHeader) {
    return NextResponse.json(
      { error: 'Missing required webhook headers' },
      { status: 400 }
    )
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json(
      { error: 'Failed to read body' },
      { status: 400 }
    )
  }

  if (!verifyWebhookHmac(rawBody, hmac)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const normalizedShop = shopDomain.toLowerCase().replace(/^https?:\/\//, '').split('/')[0] || shopDomain

  let payload: unknown
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const topic = parseWebhookTopic(topicHeader)
  if (!topic) {
    return NextResponse.json({ ok: true })
  }

  // GDPR + uninstall topics don't require a CONNECTED connection
  if (topic === 'APP_UNINSTALLED') {
    try {
      await handleAppUninstalled(normalizedShop)
    } catch (err) {
      console.error('[Shopify webhook] APP_UNINSTALLED handler error:', err)
    }
    return NextResponse.json({ ok: true })
  }

  if (topic === 'SHOP_REDACT' || topic === 'CUSTOMERS_REDACT' || topic === 'CUSTOMERS_DATA_REQUEST') {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Shopify webhook] ${topic} received for ${normalizedShop}`)
    }
    return NextResponse.json({ ok: true })
  }

  // Data webhooks require a connected store
  const connection = await prisma.shopifyConnection.findFirst({
    where: { shopDomain: normalizedShop },
    select: { id: true, status: true },
  })

  if (!connection) {
    return NextResponse.json({ error: 'Unknown shop' }, { status: 404 })
  }

  if (connection.status !== 'CONNECTED') {
    return NextResponse.json(
      { error: 'Shop not connected' },
      { status: 400 }
    )
  }

  const connectionId = connection.id

  try {
    switch (topic) {
      case 'ORDERS_CREATE':
      case 'ORDERS_UPDATED':
      case 'ORDERS_CANCELLED':
        await handleOrderWebhook(connectionId, payload as Parameters<typeof handleOrderWebhook>[1])
        break
      case 'ORDERS_DELETE':
        await handleOrderDeleteWebhook(connectionId, payload as { id?: number; admin_graphql_api_id?: string })
        break
      case 'PRODUCTS_CREATE':
      case 'PRODUCTS_UPDATE':
        await handleProductWebhook(connectionId, payload as Parameters<typeof handleProductWebhook>[1])
        break
      case 'PRODUCTS_DELETE':
        await handleProductDeleteWebhook(connectionId, payload as { id?: number; admin_graphql_api_id?: string })
        break
      case 'CUSTOMERS_CREATE':
      case 'CUSTOMERS_UPDATE':
        await handleCustomerWebhook(connectionId, payload as Parameters<typeof handleCustomerWebhook>[1])
        break
      case 'INVENTORY_LEVELS_UPDATE':
        await handleInventoryLevelWebhook(connectionId, payload as Parameters<typeof handleInventoryLevelWebhook>[1])
        break
      default:
        break
    }
  } catch (err) {
    console.error('[Shopify webhook]', topic, err)
    return NextResponse.json(
      { error: 'Processing failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
