import { prisma } from '@/lib/prisma'
import { shopifyGraphQL } from './graphql'
import { Decimal } from '@prisma/client/runtime/library'

const ORDERS_QUERY = `
  query Orders($cursor: String) {
    orders(first: 50, after: $cursor, sortKey: PROCESSED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        cursor
        node {
          id name email
          totalPriceSet { shopMoney { amount } }
          subtotalPriceSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          currencyCode
          displayFinancialStatus
          displayFulfillmentStatus
          processedAt cancelledAt tags
          customer { id }
          lineItems(first: 100) {
            edges {
              node {
                id title quantity
                originalUnitPriceSet { shopMoney { amount } }
                sku
                variant { title product { id } }
              }
            }
          }
        }
      }
    }
  }
`

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 50, after: $cursor, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id title handle vendor productType status tags
          featuredImage { url }
          totalInventory
          publishedAt
        }
      }
    }
  }
`

const CUSTOMERS_QUERY = `
  query Customers($cursor: String) {
    customers(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id email firstName lastName
          numberOfOrders amountSpent { amount }
          tags state createdAt
        }
      }
    }
  }
`

function toDecimal(value: string | number | null | undefined): Decimal {
  if (value == null || value === '') return new Decimal(0)
  return new Decimal(String(value))
}

function parseGid(gid: string): string {
  return gid.replace(/^gid:\/\/shopify\/\w+\//, '')
}


export async function syncOrders(connectionId: string): Promise<{ synced: number }> {
  const conn = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: { shopDomain: true, accessToken: true },
  })
  if (!conn?.accessToken) throw new Error('Connection not found or missing access token')

  let cursor: string | null = null
  let total = 0

  do {
    const data = await shopifyGraphQL<{
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        edges: Array<{
          node: {
            id: string
            name: string
            email: string | null
            totalPriceSet: { shopMoney: { amount: string } }
            subtotalPriceSet: { shopMoney: { amount: string } }
            totalTaxSet: { shopMoney: { amount: string } }
            totalDiscountsSet: { shopMoney: { amount: string } }
            currencyCode: string
            displayFinancialStatus: string
            displayFulfillmentStatus: string | null
            processedAt: string | null
            cancelledAt: string | null
            tags: string[]
            customer: { id: string } | null
            lineItems: { edges: Array<{ node: { id: string; title: string; quantity: number; originalUnitPriceSet: { shopMoney: { amount: string } }; sku: string | null; variant: { title: string; product: { id: string } | null } | null } }> }
          }
        }>
      }
    }>({
      shopDomain: conn.shopDomain,
      accessToken: conn.accessToken,
      query: ORDERS_QUERY,
      variables: { cursor },
    })

    const orders = data.orders
    if (!orders?.edges?.length) break

    for (const { node: order } of orders.edges) {
      const shopifyId = order.id
      const processedAt = order.processedAt ? new Date(order.processedAt) : new Date(0)
      const cancelledAt = order.cancelledAt ? new Date(order.cancelledAt) : null

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
      total++

      for (const li of order.lineItems?.edges ?? []) {
        const line = li.node
        const lineShopifyId = line.id
        const productGid = line.variant?.product?.id ?? null

        await prisma.shopifyLineItem.upsert({
          where: {
            connectionId_shopifyId: { connectionId, shopifyId: lineShopifyId },
          },
          create: {
            orderId: orderRecord.id,
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
      }
    }

    cursor = orders.pageInfo.hasNextPage ? orders.pageInfo.endCursor : null
  } while (cursor)

  return { synced: total }
}

export async function syncProducts(connectionId: string): Promise<{ synced: number }> {
  const conn = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: { shopDomain: true, accessToken: true },
  })
  if (!conn?.accessToken) throw new Error('Connection not found or missing access token')

  let cursor: string | null = null
  let total = 0

  do {
    const data = await shopifyGraphQL<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        edges: Array<{
          node: {
            id: string
            title: string
            handle: string
            vendor: string | null
            productType: string | null
            status: string
            tags: string[]
            featuredImage: { url: string } | null
            totalInventory: number | null
            publishedAt: string | null
          }
        }>
      }
    }>({
      shopDomain: conn.shopDomain,
      accessToken: conn.accessToken,
      query: PRODUCTS_QUERY,
      variables: { cursor },
    })

    const products = data.products
    if (!products?.edges?.length) break

    for (const { node: p } of products.edges) {
      await prisma.shopifyProduct.upsert({
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
      total++
    }

    cursor = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null
  } while (cursor)

  return { synced: total }
}

export async function syncCustomers(connectionId: string): Promise<{ synced: number }> {
  const conn = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: { shopDomain: true, accessToken: true },
  })
  if (!conn?.accessToken) throw new Error('Connection not found or missing access token')

  let cursor: string | null = null
  let total = 0

  do {
    const data = await shopifyGraphQL<{
      customers: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        edges: Array<{
          node: {
            id: string
            email: string | null
            firstName: string | null
            lastName: string | null
            numberOfOrders: number | string
            amountSpent: { amount: string }
            tags: string[]
            state: string | null
            createdAt: string
          }
        }>
      }
    }>({
      shopDomain: conn.shopDomain,
      accessToken: conn.accessToken,
      query: CUSTOMERS_QUERY,
      variables: { cursor },
    })

    const customers = data.customers
    if (!customers?.edges?.length) break

    for (const { node: c } of customers.edges) {
      await prisma.shopifyCustomer.upsert({
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
      total++
    }

    cursor = customers.pageInfo.hasNextPage ? customers.pageInfo.endCursor : null
  } while (cursor)

  return { synced: total }
}
