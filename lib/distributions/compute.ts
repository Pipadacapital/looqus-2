/**
 * Distributions page: per-order product-level CM1 and Sales distributions.
 * Reuses product attribution and CM1 logic from products/costs/cogs.
 *
 * AUDIT (aligned with Kleio):
 * - Unit of observation: one product-order (each order that contains the product contributes
 *   exactly one value: that product's rolled-up amount for that order).
 * - Sales: GROSS per-order product sales (sum of line price×quantity for that product in that
 *   order). Refunds are NOT subtracted for the Sales metric (order-time "what was sold").
 * - CM1: Net Revenue − COGS − Variable Costs, where Net Revenue = gross sales − allocated
 *   refunds for that product in that order. COGS/variable use shared app logic.
 * - Mode: value with highest frequency after rounding to 2 decimal places. Tie-break: smallest value.
 * - Mean: arithmetic mean of per-order values (same unit).
 * - Diff: Mode − Mean (sign kept).
 * - Orders: count of distinct orders that contain this product (= number of observations).
 *
 * Worked example (one product, 3 orders):
 *   Order A: gross 1500, refund 0, cogs 400, variable 50 → Sales=1500, CM1=1050
 *   Order B: gross 1500, refund 0, cogs 400, variable 50 → Sales=1500, CM1=1050
 *   Order C: gross 800, refund 0, cogs 200, variable 30  → Sales=800,  CM1=570
 *   Rounded (2 dp): Sales [1500, 1500, 800], CM1 [1050, 1050, 570]
 *   Sales: mode=1500 (freq 2), mean=1266.67, diff=-233.33
 *   CM1:   mode=1050 (freq 2), mean=890,     diff=-160
 */

import type { PrismaClient } from '@prisma/client'
import {
  getOrderInclusionWhere,
  getFilteredDailyAggregates,
  hasNoOrderFilters,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import { getOrderCogs, getDailyRates } from '@/lib/products/compute'
import { getShopifyStoreCurrency } from '@/lib/shopify/store-currency'

const MAX_ORDER_IDS_IN_QUERY = 10_000

export type DistributionsMetric = 'cm1' | 'sales'

export type DistributionsSortColumn =
  | 'product'
  | 'orders'
  | 'mode'
  | 'mean'
  | 'diff'

export type DistributionsTableRow = {
  product: string
  orders: number
  mode: number
  mean: number
  diff: number
}

export type DistributionsGraphPoint = {
  /** Bucket midpoint (₹) for x-axis */
  value: number
  /** Density / frequency for y-axis */
  density: number
}

export type DistributionsResult = {
  rows: DistributionsTableRow[]
  totalRows: number
  currency: string
  /** For the selected metric: all per-order values (for histogram). */
  distributionValues: number[]
  /** Global mode of the distribution (for reference line). */
  globalMode: number
  /** Global mean of the distribution (for reference line). */
  globalMean: number
  /** Histogram-like points for smooth curve (value bucket mid, density). */
  graphPoints: DistributionsGraphPoint[]
}

export type WorkspaceForDistributions = {
  id: string
  shopifyConnections: { id: string }[]
  skippedShopifyOrderTags?: string[] | null
  skipZeroSalesOrders?: boolean | null
}

/**
 * Mode: round to 2 decimal places, then the value with highest frequency.
 * Tie-break: choose the **smallest** value (deterministic, stable).
 * Used for both Sales Mode and CM1 Mode.
 */
function computeMode(values: number[]): number {
  if (values.length === 0) return 0
  const rounded = values.map((v) => Math.round(v * 100) / 100)
  const freq = new Map<number, number>()
  for (const r of rounded) {
    freq.set(r, (freq.get(r) ?? 0) + 1)
  }
  let bestValue = rounded[0]
  let bestCount = 0
  for (const [val, count] of freq) {
    if (count > bestCount || (count === bestCount && val < bestValue)) {
      bestCount = count
      bestValue = val
    }
  }
  return bestValue
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Build histogram buckets and smooth density for the graph.
 * Uses fixed bucket width derived from data range; returns points suitable for a smooth line.
 */
function buildGraphPoints(
  values: number[],
  numBuckets: number = 60
): { points: DistributionsGraphPoint[]; globalMode: number; globalMean: number } {
  const globalMean = mean(values)
  const rounded = values.map((v) => Math.round(v * 100) / 100)
  const globalMode = computeMode(values)

  if (values.length === 0) {
    return {
      points: [],
      globalMode: 0,
      globalMean: 0,
    }
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const bucketWidth = range / numBuckets
  const counts = new Array(numBuckets).fill(0)
  for (const v of values) {
    const idx = Math.min(
      numBuckets - 1,
      Math.max(0, Math.floor((v - min) / bucketWidth))
    )
    counts[idx]++
  }
  const total = values.length
  const points: DistributionsGraphPoint[] = counts.map((count, i) => ({
    value: min + (i + 0.5) * bucketWidth,
    density: total > 0 ? count / total : 0,
  }))

  return { points, globalMode, globalMean }
}

export async function computeDistributions(
  prisma: PrismaClient,
  workspace: WorkspaceForDistributions,
  params: {
    from: string
    to: string
    metric: DistributionsMetric
    search?: string
    sort?: DistributionsSortColumn
    dir?: 'asc' | 'desc'
    page: number
    pageSize: number
  }
): Promise<DistributionsResult> {
  const connections = workspace?.shopifyConnections ?? []
  const connectionId = connections[0]?.id ?? null
  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const storeCurrency = connectionId
    ? await getShopifyStoreCurrency(
        prisma,
        connectionId,
        { fromDate, toDate },
        'USD'
      )
    : 'USD'
  if (!connectionId || !workspace?.id) {
    return {
      rows: [],
      totalRows: 0,
      currency: storeCurrency,
      distributionValues: [],
      globalMode: 0,
      globalMean: 0,
      graphPoints: [],
    }
  }

  const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)
  const orderInclusionWhere = getOrderInclusionWhere(orderFilterSettings)

  const filteredDailyPromise = hasNoOrderFilters(orderFilterSettings)
    ? Promise.resolve(new Map<string, { grossSales: number; ordersCount: number }>())
    : getFilteredDailyAggregates(prisma, connectionId, fromDate, toDate, orderFilterSettings)

  const [filteredDaily, orders] = await Promise.all([
    filteredDailyPromise,
    prisma.shopifyOrder.findMany({
      where: {
        connectionId,
        processedAt: { gte: fromDate, lte: toDate },
        cancelledAt: null,
        ...orderInclusionWhere,
      },
      select: {
        id: true,
        processedAt: true,
        totalPrice: true,
      },
    }),
  ])

  const dailyRates = await getDailyRates(
    prisma,
    workspace.id,
    connectionId,
    fromDate,
    toDate,
    storeCurrency,
    orderFilterSettings,
    filteredDaily
  )

  const orderIds = orders.map((o) => o.id)
  const cogsMap = await getOrderCogs(prisma, connectionId, workspace.id, orderIds)

  const lineItemChunks = await Promise.all(
    Array.from({ length: Math.ceil(orderIds.length / MAX_ORDER_IDS_IN_QUERY) }, (_, i) => {
      const chunk = orderIds.slice(i * MAX_ORDER_IDS_IN_QUERY, (i + 1) * MAX_ORDER_IDS_IN_QUERY)
      return prisma.shopifyLineItem.findMany({
        where: { orderId: { in: chunk } },
        select: {
          id: true,
          orderId: true,
          shopifyId: true,
          productShopifyId: true,
          title: true,
          price: true,
          quantity: true,
        },
      })
    })
  )
  const lineItems = lineItemChunks.flat()
  const productIds = [...new Set(lineItems.map((li) => li.productShopifyId).filter(Boolean))] as string[]
  const products = await prisma.shopifyProduct.findMany({
    where: { connectionId, shopifyId: { in: productIds } },
    select: { shopifyId: true, title: true },
  })
  const productMap = new Map(products.map((p) => [p.shopifyId, p]))
  const lineItemById = new Map(lineItems.map((li) => [li.id, li]))
  const lineItemByShopifyId = new Map(lineItems.map((li) => [li.shopifyId, li]))

  const refundChunks = await Promise.all(
    Array.from({ length: Math.ceil(orderIds.length / MAX_ORDER_IDS_IN_QUERY) }, (_, i) => {
      const chunk = orderIds.slice(i * MAX_ORDER_IDS_IN_QUERY, (i + 1) * MAX_ORDER_IDS_IN_QUERY)
      return prisma.shopify_refund_line_items.findMany({
        where: {
          connection_id: connectionId,
          order_id: { in: chunk },
          processed_at: { gte: fromDate, lte: toDate },
        },
        select: {
          order_id: true,
          line_item_id: true,
          shopify_line_item_id: true,
          product_shopify_id: true,
          subtotal_amount: true,
        },
      })
    })
  )
  const refundLineRows = refundChunks.flat()
  const useRefundLineTable = refundLineRows.length > 0

  // (orderId, productKey) -> { sales, refunds, cogs, variableCost }
  const orderProductMap = new Map<string, Map<string, { sales: number; refunds: number; cogs: number; variableCost: number }>>()

  const orderById = new Map(orders.map((o) => [o.id, o]))
  const lineItemsByOrder = new Map<string, typeof lineItems>()
  for (const li of lineItems) {
    const list = lineItemsByOrder.get(li.orderId) ?? []
    list.push(li)
    lineItemsByOrder.set(li.orderId, list)
  }

  for (const order of orders) {
    const dateStr = order.processedAt.toISOString().slice(0, 10)
    const rates = dailyRates.get(dateStr)
    const dayOrders = rates?.ordersCount ?? 1
    const dayGross = rates?.grossSales ?? 0
    const dayReturns = rates?.totalReturns ?? 0
    const orderVariableCost = (rates?.variableCost ?? 0) / dayOrders
    const orderTotal = Number(order.totalPrice)
    const orderRefundAlloc = useRefundLineTable ? 0 : (dayGross > 0 ? (orderTotal / dayGross) * dayReturns : 0)
    const cogs = cogsMap.get(order.id) ?? 0
    const lis = lineItemsByOrder.get(order.id) ?? []
    const orderSales = lis.reduce((s, li) => s + Number(li.price) * li.quantity, 0) || 1

    let orderProduct = orderProductMap.get(order.id)
    if (!orderProduct) {
      orderProduct = new Map()
      orderProductMap.set(order.id, orderProduct)
    }

    for (const li of lis) {
      const lineSales = Number(li.price) * li.quantity
      const weight = lineSales / orderSales
      const lineRefund = orderRefundAlloc * weight
      const lineCogs = orderSales > 0 ? (lineSales / orderSales) * cogs : 0
      const lineVariable = orderSales > 0 ? (lineSales / orderSales) * orderVariableCost : 0
      const productKey = li.productShopifyId ?? '__no_product__'
      const existing = orderProduct.get(productKey) ?? { sales: 0, refunds: 0, cogs: 0, variableCost: 0 }
      orderProduct.set(productKey, {
        sales: existing.sales + lineSales,
        refunds: existing.refunds + lineRefund,
        cogs: existing.cogs + lineCogs,
        variableCost: existing.variableCost + lineVariable,
      })
    }
  }

  if (useRefundLineTable) {
    for (const rli of refundLineRows) {
      const li =
        (rli.line_item_id ? lineItemById.get(rli.line_item_id) : null) ??
        (rli.shopify_line_item_id ? lineItemByShopifyId.get(rli.shopify_line_item_id) ?? null : null)
      const productKey = (li?.productShopifyId ?? rli.product_shopify_id) ?? '__unmapped__'
      if (productKey === '__unmapped__') continue
      const orderId = rli.order_id
      const refundAmt = Number(rli.subtotal_amount)
      const orderProduct = orderProductMap.get(orderId)
      if (!orderProduct) continue
      const existing = orderProduct.get(productKey)
      if (!existing) continue
      orderProduct.set(productKey, {
        ...existing,
        refunds: existing.refunds + refundAmt,
      })
    }
  }

  // Per-product: list of per-order sales and per-order CM1
  type ProductAcc = { label: string; perOrderSales: number[]; perOrderCM1: number[] }
  const byProduct = new Map<string, ProductAcc>()

  for (const [orderId, productMapInner] of orderProductMap) {
    for (const [productKey, v] of productMapInner) {
      if (productKey === '__no_product__' || productKey === '__unmapped__') continue
      const netSales = v.sales - v.refunds
      const perOrderCM1 = netSales - v.cogs - v.variableCost
      let acc = byProduct.get(productKey)
      if (!acc) {
        acc = {
          label: productMap.get(productKey)?.title ?? productKey,
          perOrderSales: [],
          perOrderCM1: [],
        }
        byProduct.set(productKey, acc)
      }
      // Sales metric: gross (order-time) per-order product sales; no refund subtraction (Kleio-aligned).
      acc.perOrderSales.push(v.sales)
      acc.perOrderCM1.push(perOrderCM1)
    }
  }

  const allPerOrderSales: number[] = []
  const allPerOrderCM1: number[] = []
  for (const acc of byProduct.values()) {
    allPerOrderSales.push(...acc.perOrderSales)
    allPerOrderCM1.push(...acc.perOrderCM1)
  }

  const metric = params.metric ?? 'cm1'
  const distributionValues = metric === 'sales' ? allPerOrderSales : allPerOrderCM1
  const { points: graphPoints, globalMode, globalMean } = buildGraphPoints(distributionValues)

  const sort = params.sort ?? 'orders'
  const dir = params.dir ?? 'desc'
  const page = params.page ?? 1
  const pageSize = Math.min(100, Math.max(10, params.pageSize ?? 20))

  const rows: DistributionsTableRow[] = []
  for (const [productKey, acc] of byProduct) {
    const modeVal = computeMode(metric === 'sales' ? acc.perOrderSales : acc.perOrderCM1)
    const meanVal = mean(metric === 'sales' ? acc.perOrderSales : acc.perOrderCM1)
    rows.push({
      product: acc.label,
      orders: acc.perOrderSales.length,
      mode: modeVal,
      mean: meanVal,
      diff: modeVal - meanVal,
    })
  }

  let filtered = rows
  if (params.search?.trim()) {
    const q = params.search.trim().toLowerCase()
    filtered = rows.filter((r) => r.product.toLowerCase().includes(q))
  }

  const totalRows = filtered.length
  filtered.sort((a, b) => {
    let diff = 0
    switch (sort) {
      case 'product':
        diff = a.product.localeCompare(b.product)
        break
      case 'orders':
        diff = a.orders - b.orders
        break
      case 'mode':
        diff = a.mode - b.mode
        break
      case 'mean':
        diff = a.mean - b.mean
        break
      case 'diff':
        diff = a.diff - b.diff
        break
      default:
        diff = a.orders - b.orders
    }
    return dir === 'asc' ? diff : -diff
  })

  const start = (page - 1) * pageSize
  const paginated = filtered.slice(start, start + pageSize)

  return {
    rows: paginated,
    totalRows,
    currency: storeCurrency,
    distributionValues,
    globalMode,
    globalMean,
    graphPoints,
  }
}
