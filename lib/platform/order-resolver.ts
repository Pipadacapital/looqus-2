import { prisma } from '@/lib/prisma'

export interface NormalizedLineItem {
  id: string
  productId: string
  variantId: string | null
  name: string
  sku: string | null
  quantity: number
  price: number
  total: number
}

export interface NormalizedOrder {
  id: string
  orderNumber: string
  processedAt: Date
  total: number
  subtotal: number
  discountTotal: number
  shippingTotal: number
  totalTax: number
  paymentMethod: string
  isCod: boolean
  customerEmail: string | null
  customerPhone: string | null
  shippingCity: string | null
  shippingPostcode: string | null
  shippingState: string | null
  status: string
  lineItems: NormalizedLineItem[]
}

export async function getWorkspacePlatform(
  workspaceId: string
): Promise<'SHOPIFY' | 'WOOCOMMERCE'> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { platform: true },
  })
  return workspace?.platform ?? 'SHOPIFY'
}

export async function getNormalizedOrders(
  workspaceId: string,
  filters: { from?: Date; to?: Date; status?: string[] }
): Promise<NormalizedOrder[]> {
  const platform = await getWorkspacePlatform(workspaceId)

  if (platform === 'WOOCOMMERCE') {
    return getWoocommerceOrders(workspaceId, filters)
  }
  return getShopifyOrders(workspaceId, filters)
}

async function getShopifyOrders(
  workspaceId: string,
  filters: { from?: Date; to?: Date; status?: string[] }
): Promise<NormalizedOrder[]> {
  const connections = await prisma.shopifyConnection.findMany({
    where: { workspaceId, status: 'CONNECTED' },
    select: { id: true },
  })
  if (connections.length === 0) return []

  const connectionIds = connections.map((c) => c.id)

  const where: any = {
    connectionId: { in: connectionIds },
  }
  if (filters.from || filters.to) {
    where.processedAt = {}
    if (filters.from) where.processedAt.gte = filters.from
    if (filters.to) where.processedAt.lte = filters.to
  }
  if (filters.status?.length) {
    where.financialStatus = { in: filters.status }
  }

  const orders = await prisma.shopifyOrder.findMany({
    where,
    select: {
      id: true,
      orderNumber: true,
      processedAt: true,
      totalPrice: true,
      subtotalPrice: true,
      totalDiscount: true,
      totalTax: true,
      financialStatus: true,
      email: true,
      cancelledAt: true,
      lineItems: {
        select: {
          id: true,
          shopifyId: true,
          productShopifyId: true,
          title: true,
          sku: true,
          quantity: true,
          price: true,
        },
      },
    },
  })

  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    processedAt: o.processedAt,
    total: Number(o.totalPrice),
    subtotal: Number(o.subtotalPrice),
    discountTotal: Number(o.totalDiscount),
    shippingTotal: 0, // Shopify doesn't store this on the order model directly
    totalTax: Number(o.totalTax),
    paymentMethod: '',
    isCod: false,
    customerEmail: o.email ?? null,
    customerPhone: null,
    shippingCity: null,
    shippingPostcode: null,
    shippingState: null,
    status: o.financialStatus,
    lineItems: o.lineItems.map((li) => ({
      id: li.id,
      productId: li.productShopifyId ?? li.shopifyId,
      variantId: null,
      name: li.title,
      sku: li.sku ?? null,
      quantity: li.quantity,
      price: Number(li.price),
      total: Number(li.price) * li.quantity,
    })),
  }))
}

async function getWoocommerceOrders(
  workspaceId: string,
  filters: { from?: Date; to?: Date; status?: string[] }
): Promise<NormalizedOrder[]> {
  const connection = await prisma.woocommerceConnection.findUnique({
    where: { workspaceId },
    select: { id: true },
  })
  if (!connection) return []

  const where: any = {
    connectionId: connection.id,
  }
  if (filters.from || filters.to) {
    where.dateCreated = {}
    if (filters.from) where.dateCreated.gte = filters.from
    if (filters.to) where.dateCreated.lte = filters.to
  }
  if (filters.status?.length) {
    where.status = { in: filters.status }
  }

  const orders = await prisma.woocommerceOrder.findMany({
    where,
    select: {
      id: true,
      wcOrderId: true,
      orderNumber: true,
      dateCreated: true,
      total: true,
      subtotal: true,
      discountTotal: true,
      shippingTotal: true,
      totalTax: true,
      paymentMethod: true,
      isCod: true,
      customerEmail: true,
      customerPhone: true,
      shippingCity: true,
      shippingPostcode: true,
      shippingState: true,
      status: true,
      lineItems: {
        select: {
          id: true,
          productId: true,
          variationId: true,
          name: true,
          sku: true,
          quantity: true,
          price: true,
          total: true,
        },
      },
    },
  })

  return orders
    .filter((o) => o.dateCreated != null)
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber ?? String(o.wcOrderId),
      processedAt: o.dateCreated!,
      total: Number(o.total ?? 0),
      subtotal: Number(o.subtotal ?? 0),
      discountTotal: Number(o.discountTotal ?? 0),
      shippingTotal: Number(o.shippingTotal ?? 0),
      totalTax: Number(o.totalTax ?? 0),
      paymentMethod: o.paymentMethod ?? '',
      isCod: o.isCod,
      customerEmail: o.customerEmail ?? null,
      customerPhone: o.customerPhone ?? null,
      shippingCity: o.shippingCity ?? null,
      shippingPostcode: o.shippingPostcode ?? null,
      shippingState: o.shippingState ?? null,
      status: o.status ?? '',
      lineItems: o.lineItems.map((li) => ({
        id: li.id,
        productId: li.productId != null ? String(li.productId) : '',
        variantId: li.variationId != null ? String(li.variationId) : null,
        name: li.name ?? '',
        sku: li.sku ?? null,
        quantity: li.quantity ?? 0,
        price: Number(li.price ?? 0),
        total: Number(li.total ?? 0),
      })),
    }))
}
