import type { PrismaClient } from '@prisma/client'
import { getDaysInMonth } from 'date-fns'
import type { ProductsGroupBy, ProductsRow, ProductsSortColumn } from './types'
import {
  getOrderInclusionWhere,
  getFilteredDailyAggregates,
  hasNoOrderFilters,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import { resolveLineItemCogs, normalizeCogsSettings } from '@/lib/cogs'
import { getDailyVariableContribution } from '@/lib/workspace-costs'

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  INR: 83.5,
  EUR: 0.92,
  GBP: 0.79,
  AUD: 1.53,
  CAD: 1.35,
}

/** Max order IDs per query to stay under PostgreSQL bind limit (~32767). */
const MAX_ORDER_IDS_IN_QUERY = 10_000

function convertCurrency(amount: number, from: string, to: string) {
  if (!from || !to || from === to) return amount
  const fromRate = EXCHANGE_RATES[from] || 1
  const toRate = EXCHANGE_RATES[to] || 1
  return (amount / fromRate) * toRate
}

export type WorkspaceForProducts = {
  id: string
  shopifyConnections: { id: string }[]
  skippedShopifyOrderTags?: string[] | null
  skipZeroSalesOrders?: boolean | null
}

type FirstOrderRow = { customer_shopify_id: string; first_at: Date; order_id: string }

/** First order per customer (all-time) for orders in range; uses same logic as Cohorts/LTV. */
async function getFirstOrdersInRange(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  orderFilterSettings: { skippedShopifyOrderTags: string[]; skipZeroSalesOrders: boolean }
): Promise<FirstOrderRow[]> {
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
      const cid = o.customerShopifyId!
      const existing = firstByCustomer.get(cid)
      if (!existing || o.processedAt < existing.firstAt) {
        firstByCustomer.set(cid, { firstAt: o.processedAt, orderId: o.id })
      }
    }
    return [...firstByCustomer.entries()]
      .filter(([, v]) => v.firstAt >= fromDate && v.firstAt <= toDate)
      .map(([customer_shopify_id, v]) => ({
        customer_shopify_id,
        first_at: v.firstAt,
        order_id: v.orderId,
      }))
  }
  const rows = await prisma.$queryRaw<FirstOrderRow[]>`
    WITH first_orders AS (
      SELECT customer_shopify_id, MIN(processed_at) AS first_at
      FROM shopify_orders
      WHERE connection_id = ${connectionId}::uuid
        AND customer_shopify_id IS NOT NULL
        AND customer_shopify_id != ''
      GROUP BY customer_shopify_id
    )
    SELECT fo.customer_shopify_id, fo.first_at, o.id AS order_id
    FROM first_orders fo
    JOIN shopify_orders o ON o.customer_shopify_id = fo.customer_shopify_id
      AND o.processed_at = fo.first_at
      AND o.connection_id = ${connectionId}::uuid
    WHERE fo.first_at >= ${fromDate}
      AND fo.first_at <= ${toDate}
  `
  return rows
}

/** Daily: orders count, gross sales, total_returns (for refund allocation), variable cost (shipping, packaging, website, custom). Uses shared workspace-costs resolution. Exported for use in distributions. */
export async function getDailyRates(
  prisma: PrismaClient,
  workspaceId: string,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  storeCurrency: string,
  orderFilterSettings: { skippedShopifyOrderTags: string[]; skipZeroSalesOrders: boolean },
  filteredDaily?: Map<string, { grossSales: number; ordersCount: number }>
): Promise<
  Map<
    string,
    {
      ordersCount: number
      grossSales: number
      totalReturns: number
      variableCost: number
    }
  >
> {
  const daily = await prisma.shopifyAnalyticsDaily.findMany({
    where: { connectionId, date: { gte: fromDate, lte: toDate } },
    select: { date: true, ordersCount: true, grossSales: true, total_returns: true },
  })
  const workspaceCosts = await prisma.workspaceCost.findMany({
    where: { workspaceId, effectiveFrom: { lte: toDate } },
  })
  const map = new Map<
    string,
    { ordersCount: number; grossSales: number; totalReturns: number; variableCost: number }
  >()
  for (const d of daily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    const filtered = filteredDaily?.get(dateStr)
    const ordersCount = filtered ? filtered.ordersCount : d.ordersCount
    const grossSales = filtered ? filtered.grossSales : Number(d.grossSales)
    let variableCost = 0
    for (const cost of workspaceCosts) {
      const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
      const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
      if (dateStr < costFromStr || dateStr > costToStr) continue
      variableCost += getDailyVariableContribution(
        {
          costType: cost.costType,
          amount: Number(cost.amount),
          currency: cost.currency,
          isPercent: cost.isPercent,
          billingMode: cost.billingMode ?? 'monthly',
        },
        dateStr,
        ordersCount,
        grossSales,
        storeCurrency
      )
    }
    // Refunds: Shopify analytics total_returns. Ensure non-negative (P&L uses Math.abs for safety).
    const rawReturns = Number(d.total_returns ?? 0)
    const totalReturns = Math.max(0, rawReturns)
    map.set(dateStr, {
      ordersCount: ordersCount || 1,
      grossSales,
      totalReturns,
      variableCost,
    })
  }
  return map
}

/** COGS per order (uses shared COGS resolution). Exported for use in distributions. */
export async function getOrderCogs(
  prisma: PrismaClient,
  connectionId: string,
  workspaceId: string,
  orderIds: string[]
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map()
  const [products, cogsSettings, ...itemChunks] = await Promise.all([
    prisma.shopifyProduct.findMany({
      where: { connectionId },
      select: { shopifyId: true, coq: true },
    }),
    prisma.workspaceCogsSettings.findUnique({
      where: { workspaceId },
    }),
    ...Array.from({ length: Math.ceil(orderIds.length / MAX_ORDER_IDS_IN_QUERY) }, (_, i) => {
      const chunk = orderIds.slice(i * MAX_ORDER_IDS_IN_QUERY, (i + 1) * MAX_ORDER_IDS_IN_QUERY)
      return prisma.shopifyLineItem.findMany({
        where: { orderId: { in: chunk } },
        select: { orderId: true, productShopifyId: true, quantity: true, price: true },
      })
    }),
  ])
  const items = itemChunks.flat()
  const coqMap = new Map(products.filter((p) => p.coq).map((p) => [p.shopifyId, Number(p.coq)]))
  const settings = normalizeCogsSettings(cogsSettings)
  const cogsByOrder = new Map<string, number>()
  for (const it of items) {
    const cogs = resolveLineItemCogs(
      { price: Number(it.price), quantity: it.quantity, productShopifyId: it.productShopifyId },
      coqMap,
      settings
    )
    cogsByOrder.set(it.orderId, (cogsByOrder.get(it.orderId) ?? 0) + cogs)
  }
  return cogsByOrder
}

/** Pareto grade: A = top 80% of cumulative positive CM1, B = next 15%, C = bottom 5%, F = negative CM1. */
function computeParetoGrade(cm1: number, sortedPositiveCm1: number[], rankIndex: number): 'A' | 'B' | 'C' | 'F' {
  if (cm1 < 0) return 'F'
  const totalPositive = sortedPositiveCm1.reduce((a, b) => a + b, 0)
  if (totalPositive <= 0) return 'C'
  let cum = 0
  for (let i = 0; i < sortedPositiveCm1.length; i++) {
    cum += sortedPositiveCm1[i]
    const pct = cum / totalPositive
    if (i === rankIndex) {
      if (pct <= 0.8) return 'A'
      if (pct <= 0.95) return 'B'
      return 'C'
    }
  }
  return 'C'
}

export async function computeProducts(
  prisma: PrismaClient,
  workspace: WorkspaceForProducts,
  params: {
    from: string
    to: string
    groupBy: ProductsGroupBy
    search?: string
    sort?: ProductsSortColumn
    dir?: 'asc' | 'desc'
    page: number
    pageSize: number
  }
): Promise<{ rows: ProductsRow[]; totalRows: number; currency: string }> {
  const connections = workspace?.shopifyConnections ?? []
  const connectionId = connections[0]?.id ?? null
  const storeCurrency = 'INR'
  if (!connectionId || !workspace?.id) {
    return { rows: [], totalRows: 0, currency: storeCurrency }
  }

  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)
  const orderInclusionWhere = getOrderInclusionWhere(orderFilterSettings)

  const filteredDailyPromise = hasNoOrderFilters(orderFilterSettings)
    ? Promise.resolve(new Map<string, { grossSales: number; ordersCount: number }>())
    : getFilteredDailyAggregates(prisma, connectionId, fromDate, toDate, orderFilterSettings)

  const [firstOrders, filteredDaily, orders] = await Promise.all([
    getFirstOrdersInRange(prisma, connectionId, fromDate, toDate, orderFilterSettings),
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
        customerShopifyId: true,
        processedAt: true,
        totalPrice: true,
        totalTax: true,
        tags: true,
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

  const firstByCustomer = new Map<string, { firstAt: Date; orderId: string }>()
  for (const r of firstOrders) {
    firstByCustomer.set(r.customer_shopify_id, { firstAt: r.first_at, orderId: r.order_id })
  }

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
          variantTitle: true,
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
    select: { shopifyId: true, title: true, vendor: true, productType: true, tags: true },
  })
  const productMap = new Map(products.map((p) => [p.shopifyId, p]))
  const lineItemById = new Map(lineItems.map((li) => [li.id, li]))
  /** Fallback when refund line has line_item_id null but shopify_line_item_id (GID) set */
  const lineItemByShopifyId = new Map(lineItems.map((li) => [li.shopifyId, li]))

  // Source of truth for Product/Variant: Sold = sum(lineItems.quantity), Refunded = sum(refundLineItems.quantity),
  // Refunds = sum(refund line subtotalAmount). We do NOT use shopify_analytics_daily for product-level sold/refunded.
  // Primary source for refunds: shopify_refund_line_items. When absent, fall back to daily total_returns allocation.
  // Batch by orderIds to stay under PostgreSQL max bind params (~32767).
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
          quantity: true,
          subtotal_amount: true,
          processed_at: true,
        },
      })
    })
  )
  const refundLineRows = refundChunks.flat()
  const useRefundLineTable = refundLineRows.length > 0

  // ─── Dev diagnostics: refund data path ───
  if (process.env.NODE_ENV === 'development') {
    const sampleRefundRows = refundLineRows.slice(0, 5).map((r) => ({
      order_id: r.order_id,
      line_item_id: r.line_item_id ?? null,
      shopify_line_item_id: r.shopify_line_item_id ?? null,
      product_shopify_id: r.product_shopify_id ?? null,
      quantity: r.quantity,
      subtotal_amount: Number(r.subtotal_amount),
      processed_at: r.processed_at?.toISOString?.() ?? null,
    }))
    console.log('[Products REFUND DIAG]', {
      useRefundLineTable,
      refundRowsLoaded: refundLineRows.length,
      connectionId,
      dateRange: { from: params.from, to: params.to },
      sampleRefundRows,
    })
  }

  type Agg = {
    label: string
    sales: number
    refunds: number
    sold: number
    refunded: number
    orders: Set<string>
    ncOrders: Set<string>
    ecOrders: Set<string>
    ncSales: number
    ecSales: number
    ncRefunds: number
    ecRefunds: number
    ncRevenue: number
    ecRevenue: number
    ncSold: number
    ncRefunded: number
    ecSold: number
    ecRefunded: number
    cogs: number
    variableCost: number
  }

  const aggByKey = new Map<string, Agg>()

  function getOrCreate(key: string, label: string): Agg {
    let a = aggByKey.get(key)
    if (!a) {
      a = {
        label,
        sales: 0,
        refunds: 0,
        sold: 0,
        refunded: 0,
        orders: new Set(),
        ncOrders: new Set(),
        ecOrders: new Set(),
        ncSales: 0,
        ecSales: 0,
        ncRefunds: 0,
        ecRefunds: 0,
        ncRevenue: 0,
        ecRevenue: 0,
        ncSold: 0,
        ncRefunded: 0,
        ecSold: 0,
        ecRefunded: 0,
        cogs: 0,
        variableCost: 0,
      }
      aggByKey.set(key, a)
    }
    return a
  }

  /** Per-line refunded quantity fallback: no line-level refund qty in DB; allocate by (refund_amt / sales) * qty, clamp to [0, qty], round. */
  function lineRefundedQtyFallback(lineRefund: number, lineSales: number, quantity: number): number {
    if (lineSales <= 0 || quantity <= 0) return 0
    const raw = (lineRefund / lineSales) * quantity
    const rounded = Math.round(raw)
    return Math.max(0, Math.min(quantity, rounded))
  }

  const orderList = orders
  const orderById = new Map(orderList.map((o) => [o.id, o]))
  const lineItemsByOrder = new Map<string, typeof lineItems>()
  for (const li of lineItems) {
    const list = lineItemsByOrder.get(li.orderId) ?? []
    list.push(li)
    lineItemsByOrder.set(li.orderId, list)
  }

  const orderIdToNc = new Map<string, boolean>()

  for (const order of orderList) {
    const dateStr = order.processedAt.toISOString().slice(0, 10)
    const rates = dailyRates.get(dateStr)
    const dayOrders = rates?.ordersCount ?? 1
    const dayGross = rates?.grossSales ?? 0
    const dayReturns = rates?.totalReturns ?? 0
    const orderVariableCost = (rates?.variableCost ?? 0) / dayOrders
    const orderTotal = Number(order.totalPrice)
    const custId = order.customerShopifyId
    const first = custId ? firstByCustomer.get(custId) : null
    const isNc = first != null && order.id === first.orderId
    orderIdToNc.set(order.id, isNc)
    // Refund: primary source is shopify_refund_line_items (see below). Fallback = daily total_returns allocation.
    const orderRefundAlloc = useRefundLineTable ? 0 : (dayGross > 0 ? (orderTotal / dayGross) * dayReturns : 0)
    const cogs = cogsMap.get(order.id) ?? 0
    const lis = lineItemsByOrder.get(order.id) ?? []
    const orderSales = lis.reduce((s, li) => s + Number(li.price) * li.quantity, 0) || 1

    for (const li of lis) {
      const lineSales = Number(li.price) * li.quantity
      const weight = lineSales / orderSales
      const lineRefund = orderRefundAlloc * weight
      const lineRefundedQty = useRefundLineTable ? 0 : lineRefundedQtyFallback(lineRefund, lineSales, li.quantity)
      const lineCogs = orderSales > 0 ? (lineSales / orderSales) * cogs : 0
      const lineVariable = orderSales > 0 ? (lineSales / orderSales) * orderVariableCost : 0
      const product = li.productShopifyId ? productMap.get(li.productShopifyId) : null
      const orderTags = (order as { tags?: string[] }).tags ?? []

      const keys: { key: string; label: string; w: number }[] = []

      if (params.groupBy === 'product') {
        const key = li.productShopifyId ?? '__no_product__'
        const label = product?.title ?? li.title
        keys.push({ key, label, w: 1 })
      } else if (params.groupBy === 'variant') {
        const vKey = (li.productShopifyId ?? '') + '|' + (li.variantTitle ?? 'default')
        const label = `${product?.title ?? li.title}${li.variantTitle ? ` - ${li.variantTitle}` : ''}`
        keys.push({ key: vKey, label, w: 1 })
      } else if (params.groupBy === 'vendor') {
        const vendor = product?.vendor ?? '—'
        const key = vendor || '__no_vendor__'
        keys.push({ key, label: vendor || '—', w: 1 })
      } else if (params.groupBy === 'type') {
        const pt = product?.productType ?? '—'
        const key = pt || '__no_type__'
        keys.push({ key, label: pt || '—', w: 1 })
      } else if (params.groupBy === 'product_tags') {
        const tags = product?.tags ?? []
        const w = 1 / Math.max(tags.length || 1, 1)
        for (const tag of tags) {
          keys.push({ key: tag, label: tag, w })
        }
        if (tags.length === 0) keys.push({ key: '__no_tag__', label: '—', w: 1 })
      } else if (params.groupBy === 'order_tags') {
        for (const tag of orderTags) {
          keys.push({ key: tag, label: tag, w: 1 })
        }
        if (orderTags.length === 0) keys.push({ key: '__no_tag__', label: '—', w: 1 })
      } else if (params.groupBy === 'collection') {
        keys.push({ key: '—', label: '—', w: 1 })
      } else if (params.groupBy === 'discount_codes') {
        keys.push({ key: '—', label: '—', w: 1 })
      } else {
        keys.push({ key: '__unknown__', label: '—', w: 1 })
      }

      for (const { key, label, w } of keys) {
        const agg = getOrCreate(key, label)
        agg.sales += lineSales * w
        agg.refunds += lineRefund * w
        agg.sold += li.quantity * w
        agg.refunded += lineRefundedQty * w
        agg.cogs += lineCogs * w
        agg.variableCost += lineVariable * w
        agg.orders.add(order.id)
        if (isNc) {
          agg.ncOrders.add(order.id)
          agg.ncSales += lineSales * w
          agg.ncRefunds += lineRefund * w
          agg.ncRevenue += (lineSales - lineRefund) * w
          agg.ncSold += li.quantity * w
          agg.ncRefunded += lineRefundedQty * w
        } else {
          agg.ecOrders.add(order.id)
          agg.ecSales += lineSales * w
          agg.ecRefunds += lineRefund * w
          agg.ecRevenue += (lineSales - lineRefund) * w
          agg.ecSold += li.quantity * w
          agg.ecRefunded += lineRefundedQty * w
        }
      }
    }
  }

  // Primary source: aggregate from shopify_refund_line_items (exact refund qty and amount per line).
  // Resolve line item: by DB line_item_id first, then by shopify_line_item_id (GID) when line_item_id is null.
  // Unmapped: refund lines with no line item in DB and no productShopifyId are skipped (not attributed to any product group).
  let refundRowsMapped = 0
  let refundRowsDropped = 0
  if (useRefundLineTable) {
    for (const rli of refundLineRows) {
      const li =
        (rli.line_item_id ? lineItemById.get(rli.line_item_id) : null) ??
        (rli.shopify_line_item_id ? lineItemByShopifyId.get(rli.shopify_line_item_id) ?? null : null)
      const product = li?.productShopifyId
        ? productMap.get(li.productShopifyId)
        : rli.product_shopify_id
          ? productMap.get(rli.product_shopify_id)
          : null
      const order = orderById.get(rli.order_id)
      const orderTags = (order as { tags?: string[] } | undefined)?.tags ?? []
      const isNc = orderIdToNc.get(rli.order_id) ?? false
      const refundAmt = Number(rli.subtotal_amount)
      const refundQty = rli.quantity

      const keys: { key: string; label: string; w: number }[] = []
      if (params.groupBy === 'product') {
        const key = (li?.productShopifyId ?? rli.product_shopify_id) ?? '__unmapped__'
        if (key === '__unmapped__') {
          refundRowsDropped++
          continue
        }
        const label = product?.title ?? (li?.title ?? '—')
        keys.push({ key, label, w: 1 })
      } else if (params.groupBy === 'variant') {
        const vKey = (li?.productShopifyId ?? rli.product_shopify_id ?? '') + '|' + (li?.variantTitle ?? 'default')
        if (!(li?.productShopifyId ?? rli.product_shopify_id)) {
          refundRowsDropped++
          continue
        }
        const label = `${product?.title ?? li?.title ?? '—'}${li?.variantTitle ? ` - ${li.variantTitle}` : ''}`
        keys.push({ key: vKey, label, w: 1 })
      } else if (params.groupBy === 'vendor') {
        const vendor = product?.vendor ?? '—'
        const key = vendor || '__no_vendor__'
        keys.push({ key, label: vendor || '—', w: 1 })
      } else if (params.groupBy === 'type') {
        const pt = product?.productType ?? '—'
        const key = pt || '__no_type__'
        keys.push({ key, label: pt || '—', w: 1 })
      } else if (params.groupBy === 'product_tags') {
        const tags = product?.tags ?? []
        const w = 1 / Math.max(tags.length || 1, 1)
        for (const tag of tags) {
          keys.push({ key: tag, label: tag, w })
        }
        if (tags.length === 0) keys.push({ key: '__no_tag__', label: '—', w: 1 })
      } else if (params.groupBy === 'order_tags') {
        for (const tag of orderTags) {
          keys.push({ key: tag, label: tag, w: 1 })
        }
        if (orderTags.length === 0) keys.push({ key: '__no_tag__', label: '—', w: 1 })
      } else if (params.groupBy === 'collection' || params.groupBy === 'discount_codes') {
        keys.push({ key: '—', label: '—', w: 1 })
      } else {
        keys.push({ key: '__unknown__', label: '—', w: 1 })
      }

      for (const { key, label, w } of keys) {
        const agg = getOrCreate(key, label)
        agg.refunds += refundAmt * w
        agg.refunded += refundQty * w
        if (isNc) {
          agg.ncRefunds += refundAmt * w
          agg.ncRefunded += refundQty * w
          agg.ncRevenue -= refundAmt * w
        } else {
          agg.ecRefunds += refundAmt * w
          agg.ecRefunded += refundQty * w
          agg.ecRevenue -= refundAmt * w
        }
      }
    }
    refundRowsMapped = refundLineRows.length - refundRowsDropped
    if (process.env.NODE_ENV === 'development') {
      console.log('[Products REFUND DIAG] mapping', {
        refundRowsLoaded: refundLineRows.length,
        refundRowsMapped,
        refundRowsDropped,
      })
    }
  }

  const totalCm1 = [...aggByKey.values()].reduce(
    (s, a) => s + (a.sales - a.refunds - a.cogs - a.variableCost),
    0
  )
  const sortedByCm1 = [...aggByKey.entries()].sort((a, b) => {
    const cm1A = a[1].sales - a[1].refunds - a[1].cogs - a[1].variableCost
    const cm1B = b[1].sales - b[1].refunds - b[1].cogs - b[1].variableCost
    return cm1B - cm1A
  })
  const positiveCm1List = sortedByCm1
    .map(([, a]) => a.sales - a.refunds - a.cogs - a.variableCost)
    .filter((v) => v > 0)

  const rows: ProductsRow[] = []
  for (let i = 0; i < sortedByCm1.length; i++) {
    const [, a] = sortedByCm1[i]
    // Base metrics: Sold and Refunded are non-negative integers. Revenue = Sales - Refunds (explicit).
    const sold = Math.round(a.sold)
    const refunded = Math.min(Math.round(a.refunded), sold)
    const revenue = a.sales - a.refunds
    const netQuantity = sold - refunded
    const ordersCount = a.orders.size
    const ncOrdersCount = a.ncOrders.size
    const ecOrdersCount = a.ecOrders.size
    const ncSold = Math.round(a.ncSold)
    const ncRefunded = Math.min(Math.round(a.ncRefunded), ncSold)
    const ecSold = Math.round(a.ecSold)
    const ecRefunded = Math.min(Math.round(a.ecRefunded), ecSold)
    const returnRate = sold > 0 ? (refunded / sold) * 100 : 0
    const ncReturnRate = ncSold > 0 ? (ncRefunded / ncSold) * 100 : 0
    const ecReturnRate = ecSold > 0 ? (ecRefunded / ecSold) * 100 : 0
    const cm1 = revenue - a.cogs - a.variableCost
    const positiveRank = sortedByCm1
      .slice(0, i)
      .filter(([, r]) => (r.sales - r.refunds - r.cogs - r.variableCost) > 0).length
    const paretoGrade = computeParetoGrade(cm1, positiveCm1List, positiveRank)
    const cm1Pct = revenue > 0 ? (cm1 / revenue) * 100 : 0
    const cm1Total = totalCm1 !== 0 ? (cm1 / totalCm1) * 100 : 0
    const aovVal = ordersCount > 0 ? revenue / ordersCount : 0
    const ncAovVal = ncOrdersCount > 0 ? a.ncRevenue / ncOrdersCount : 0
    const ecAovVal = ecOrdersCount > 0 ? a.ecRevenue / ecOrdersCount : 0

    rows.push({
      label: a.label,
      paretoGrade,
      cm1,
      cm1Pct,
      cm1Total,
      sales: a.sales,
      refunds: a.refunds,
      revenue,
      sold,
      refunded,
      netQuantity,
      returnRate,
      ncReturnRate,
      ecReturnRate,
      orders: ordersCount,
      ncOrders: ncOrdersCount,
      ecOrders: ecOrdersCount,
      aov: aovVal,
      ncAov: ncAovVal,
      ecAov: ecAovVal,
    })
  }

  let filtered = rows
  if (params.search && params.search.trim()) {
    const q = params.search.trim().toLowerCase()
    filtered = rows.filter((r) => r.label.toLowerCase().includes(q))
  }

  const totalRows = filtered.length
  const sort = params.sort ?? 'cm1'
  const dir = params.dir ?? 'desc'
  const paretoOrder = { A: 4, B: 3, C: 2, F: 1 } as const
  filtered.sort((a, b) => {
    let diff = 0
    switch (sort) {
      case 'label':
        diff = a.label.localeCompare(b.label)
        break
      case 'pareto_grade':
        diff = (paretoOrder[a.paretoGrade] ?? 0) - (paretoOrder[b.paretoGrade] ?? 0)
        break
      case 'cm1':
        diff = a.cm1 - b.cm1
        break
      case 'cm1_pct':
        diff = a.cm1Pct - b.cm1Pct
        break
      case 'cm1_total':
        diff = a.cm1Total - b.cm1Total
        break
      case 'sales':
        diff = a.sales - b.sales
        break
      case 'refunds':
        diff = a.refunds - b.refunds
        break
      case 'revenue':
        diff = a.revenue - b.revenue
        break
      case 'sold':
        diff = a.sold - b.sold
        break
      case 'refunded':
        diff = a.refunded - b.refunded
        break
      case 'net_quantity':
        diff = a.netQuantity - b.netQuantity
        break
      case 'return_rate':
        diff = a.returnRate - b.returnRate
        break
      case 'nc_return_rate':
        diff = a.ncReturnRate - b.ncReturnRate
        break
      case 'ec_return_rate':
        diff = a.ecReturnRate - b.ecReturnRate
        break
      case 'orders':
        diff = a.orders - b.orders
        break
      case 'nc_orders':
        diff = a.ncOrders - b.ncOrders
        break
      case 'ec_orders':
        diff = a.ecOrders - b.ecOrders
        break
      case 'aov':
        diff = a.aov - b.aov
        break
      case 'nc_aov':
        diff = a.ncAov - b.ncAov
        break
      case 'ec_aov':
        diff = a.ecAov - b.ecAov
        break
      default:
        diff = a.cm1 - b.cm1
    }
    return dir === 'asc' ? diff : -diff
  })

  const start = (params.page - 1) * params.pageSize
  const paginated = filtered.slice(start, start + params.pageSize)

  // ─── DEBUG: one product and one variant row (temporary validation) ───
  // Logs: sold (from line items), refunded (from refund line items), refunds amount, revenue, orders, nc/ec split.
  if (process.env.NODE_ENV === 'development' && rows.length > 0) {
    const sampleProduct =
      params.groupBy === 'product'
        ? rows.find((r) => r.label !== '—' && r.sold > 0) ?? rows[0]
        : null
    const sampleVariant =
      params.groupBy === 'variant'
        ? rows.find((r) => r.label !== '—' && r.sold > 0) ?? rows[0]
        : null
    const sourceExact = useRefundLineTable
    const debugRow = (row: ProductsRow, kind: 'product' | 'variant') => ({
      kind,
      label: row.label,
      sold_from_line_items: row.sold,
      refunded_from_refund_line_items: row.refunded,
      refunds_amount: row.refunds,
      revenue: row.revenue,
      orders: row.orders,
      nc_ec_split: { ncOrders: row.ncOrders, ecOrders: row.ecOrders },
      netQuantity: row.netQuantity,
      returnRate: row.returnRate,
      aov: row.aov,
      ncAov: row.ncAov,
      ecAov: row.ecAov,
      source: sourceExact ? 'exact (refund line table)' : 'fallback (daily allocation)',
    })
    if (sampleProduct) {
      console.log('[Products DEBUG] one product', JSON.stringify(debugRow(sampleProduct, 'product'), null, 2))
    }
    if (sampleVariant) {
      console.log('[Products DEBUG] one variant', JSON.stringify(debugRow(sampleVariant, 'variant'), null, 2))
    }

    // Validation: one product — raw line item quantity/sales vs agg; raw refund line quantity/amount vs agg when using refund table
    if (params.groupBy === 'product') {
      const firstProductKey = sortedByCm1.find(
        ([k]) =>
          k !== '__no_product__' && k !== '—' && k !== '__no_vendor__' && k !== '__no_type__' && k !== '__no_tag__'
      )?.[0]
      if (firstProductKey) {
        const rawItems = await prisma.shopifyLineItem.findMany({
          where: {
            connectionId,
            productShopifyId: firstProductKey,
            order: {
              processedAt: { gte: fromDate, lte: toDate },
              cancelledAt: null,
              ...orderInclusionWhere,
            },
          },
          select: { orderId: true, quantity: true, price: true },
        })
        const rawOrderIds = [...new Set(rawItems.map((r) => r.orderId))]
        const rawSoldQty = rawItems.reduce((s, r) => s + r.quantity, 0)
        const rawSales = rawItems.reduce((s, r) => s + Number(r.price) * r.quantity, 0)
        const agg = aggByKey.get(firstProductKey)
        let rawRefundedQty: number | null = null
        let rawRefundsAmt: number | null = null
        const productRefundLines = useRefundLineTable
          ? refundLineRows.filter((r) => {
              const resolvedLi =
                (r.line_item_id ? lineItemById.get(r.line_item_id) : null) ??
                (r.shopify_line_item_id ? lineItemByShopifyId.get(r.shopify_line_item_id) ?? null : null)
              return (
                r.product_shopify_id === firstProductKey ||
                (resolvedLi?.productShopifyId === firstProductKey)
              )
            })
          : []
        if (useRefundLineTable) {
          rawRefundedQty = productRefundLines.reduce((s, r) => s + r.quantity, 0)
          rawRefundsAmt = productRefundLines.reduce((s, r) => s + Number(r.subtotal_amount), 0)
        }
        const dayRefundTotal = [...dailyRates.values()].reduce((s, d) => s + d.totalReturns, 0)
        console.log('[Products VALIDATION] one product vs raw', {
          productKey: firstProductKey,
          sold_from_line_items: { rawQuantity: rawSoldQty, aggSoldRounded: agg ? Math.round(agg.sold) : null },
          refunded_from_refund_line_items:
            useRefundLineTable && rawRefundedQty !== null && rawRefundsAmt !== null
              ? { rawRefundedQty, rawRefundsAmt: Math.round(rawRefundsAmt * 100) / 100, aggRefunded: agg ? Math.round(agg.refunded) : null, aggRefunds: agg ? Math.round(agg.refunds * 100) / 100 : null }
              : { fallback: 'daily allocation', dailyRefundTotal: Math.round(dayRefundTotal * 100) / 100, aggRefunds: agg ? Math.round(agg.refunds * 100) / 100 : null },
          rawOrderCount: rawOrderIds.length,
          aggOrderCount: agg?.orders.size,
          rawSales: Math.round(rawSales * 100) / 100,
          aggSales: agg ? Math.round(agg.sales * 100) / 100 : null,
        })
        // Worked example: raw refund lines → matched line item → final product row
        if (useRefundLineTable && firstProductKey && productRefundLines.length > 0) {
          const firstRefund = productRefundLines[0]
          const matchedLi =
            (firstRefund.line_item_id ? lineItemById.get(firstRefund.line_item_id) : null) ??
            (firstRefund.shopify_line_item_id ? lineItemByShopifyId.get(firstRefund.shopify_line_item_id) ?? null : null)
          const finalRow = rows.find((r) => r.label === (aggByKey.get(firstProductKey)?.label ?? ''))
          console.log('[Products WORKED EXAMPLE]', {
            productKey: firstProductKey,
            rawRefundLine: {
              order_id: firstRefund.order_id,
              line_item_id: firstRefund.line_item_id ?? null,
              shopify_line_item_id: firstRefund.shopify_line_item_id ?? null,
              product_shopify_id: firstRefund.product_shopify_id ?? null,
              quantity: firstRefund.quantity,
              subtotal_amount: Number(firstRefund.subtotal_amount),
            },
            matchedLineItem: matchedLi
              ? { id: matchedLi.id, orderId: matchedLi.orderId, productShopifyId: matchedLi.productShopifyId, quantity: matchedLi.quantity }
              : null,
            productRefundLinesCount: productRefundLines.length,
            finalProductRow: finalRow
              ? { sales: finalRow.sales, refunds: finalRow.refunds, revenue: finalRow.revenue, sold: finalRow.sold, refunded: finalRow.refunded, netQuantity: finalRow.netQuantity, returnRate: finalRow.returnRate }
              : null,
          })
        }
      }
    }
  }

  return {
    rows: paginated,
    totalRows,
    currency: storeCurrency,
  }
}
