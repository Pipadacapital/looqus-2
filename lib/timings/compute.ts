import type { PrismaClient } from '@prisma/client'
import type {
  TimingsGroupBy,
  TimingsGroupRow,
  TimingsMetric,
  TimingsSummary,
} from './types'

const REACTIVATION_PCT_OF_1TO2 = 0.8 // 80% of typical 1→2 interval = recommended reactivation timing

type FirstOrderRow = {
  customer_shopify_id: string
  first_at: Date
  order_id: string
}

type OrderRow = {
  id: string
  customerShopifyId: string | null
  processedAt: Date
}

type LineItemRow = {
  orderId: string
  productShopifyId: string | null
  title: string
  variantTitle: string | null
}

type ProductInfo = {
  id: string
  shopifyId: string
  title: string
  vendor: string | null
  productType: string | null
}

type CustomerMetrics = {
  has2nd: boolean
  has3rd: boolean
  has4th: boolean
  days1to2: number | null
  days2to3: number | null
  days3to4: number | null
}

type GroupEntry = {
  id: string
  label: string
  groupBy: TimingsGroupBy
  customers: Map<string, CustomerMetrics>
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2
  }
  return sorted[mid]!
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function pickMetric(values: number[], metric: TimingsMetric): number {
  return metric === 'median' ? median(values) : mean(values)
}

function emptySummary(): TimingsSummary {
  return {
    firstOrders: 0,
    secondOrdersPct: 0,
    thirdOrdersPct: 0,
    fourthOrdersPct: 0,
    median1to2: 0,
    median2to3: 0,
    median3to4: 0,
    reactivationDays: 0,
  }
}

function normalizeGroupLabel(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

function getGroupIdentity(params: {
  groupBy: TimingsGroupBy
  lineItem: LineItemRow
  product: ProductInfo | null
}): { key: string; id: string; label: string; include: boolean } {
  const { groupBy, lineItem, product } = params
  const productTitle = product?.title ?? lineItem.title

  switch (groupBy) {
    case 'variant': {
      const variantLabel = normalizeGroupLabel(lineItem.variantTitle, 'Default variant')
      const key = `variant:${lineItem.productShopifyId ?? productTitle}:${variantLabel}`
      return {
        key,
        id: key,
        label: `${productTitle} - ${variantLabel}`,
        include: true,
      }
    }
    case 'vendor': {
      const label = normalizeGroupLabel(product?.vendor, 'Unknown vendor')
      return {
        key: `vendor:${label.toLowerCase()}`,
        id: `vendor:${label.toLowerCase()}`,
        label,
        include: true,
      }
    }
    case 'productType': {
      const label = normalizeGroupLabel(product?.productType, 'Uncategorized')
      return {
        key: `productType:${label.toLowerCase()}`,
        id: `productType:${label.toLowerCase()}`,
        label,
        include: true,
      }
    }
    case 'product':
    default: {
      const key = lineItem.productShopifyId ?? `title:${lineItem.title}`
      return {
        key,
        id: product?.id ?? `line-${key}`,
        label: productTitle,
        include: true,
      }
    }
  }
}

async function getFirstOrders(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<FirstOrderRow[]> {
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

export type WorkspaceForTimings = {
  id: string
  shopifyConnections: { id: string }[]
}

export async function computeTimings(
  prisma: PrismaClient,
  workspace: WorkspaceForTimings,
  params: {
    from: string
    to: string
    metric: TimingsMetric
    groupBy?: TimingsGroupBy
    groupId?: string
  }
): Promise<{ summary: TimingsSummary; groups: TimingsGroupRow[]; currency: string }> {
  const connectionId = workspace.shopifyConnections[0]?.id
  const groupBy = params.groupBy ?? 'product'
  if (!connectionId) {
    return {
      summary: emptySummary(),
      groups: [],
      currency: 'USD',
    }
  }

  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const toDateExtended = new Date(toDate)
  toDateExtended.setUTCDate(toDateExtended.getUTCDate() + 365)

  const firstOrders = await getFirstOrders(prisma, connectionId, fromDate, toDate)
  if (firstOrders.length === 0) {
    return {
      summary: emptySummary(),
      groups: [],
      currency: 'USD',
    }
  }

  const customerIds = firstOrders.map((r) => r.customer_shopify_id)
  const firstByCustomer = new Map<string, { firstAt: Date; orderId: string }>()
  for (const r of firstOrders) {
    firstByCustomer.set(r.customer_shopify_id, {
      firstAt: r.first_at,
      orderId: r.order_id,
    })
  }

  const orders = await prisma.shopifyOrder.findMany({
    where: {
      connectionId,
      customerShopifyId: { in: customerIds },
      processedAt: { lte: toDateExtended },
    },
    select: { id: true, customerShopifyId: true, processedAt: true },
    orderBy: { processedAt: 'asc' },
  })

  const firstOrderIds = new Set(firstOrders.map((r) => r.order_id))
  const lineItems = await prisma.shopifyLineItem.findMany({
    where: { orderId: { in: Array.from(firstOrderIds) } },
    select: {
      orderId: true,
      productShopifyId: true,
      title: true,
      variantTitle: true,
    },
  })

  const productsByShopifyId = await prisma.shopifyProduct.findMany({
    where: { connectionId },
    select: {
      id: true,
      shopifyId: true,
      title: true,
      vendor: true,
      productType: true,
    },
  })
  const productMap = new Map(productsByShopifyId.map((p) => [p.shopifyId, p]))

  const orderByCustomer = new Map<string, OrderRow[]>()
  for (const o of orders) {
    const cid = o.customerShopifyId
    if (!cid) continue
    if (!orderByCustomer.has(cid)) orderByCustomer.set(cid, [])
    orderByCustomer.get(cid)!.push(o)
  }

  const days1to2All: number[] = []
  const days2to3All: number[] = []
  const days3to4All: number[] = []

  let count2nd = 0
  let count3rd = 0
  let count4th = 0

  const groupsToCustomers = new Map<string, GroupEntry>()

  for (const fo of firstOrders) {
    const cid = fo.customer_shopify_id
    const customerOrders = orderByCustomer.get(cid) ?? []
    const foInfo = firstByCustomer.get(cid)!
    const firstOrderItems = lineItems.filter((li) => li.orderId === foInfo.orderId)

    const orderDates = customerOrders.map((o) => o.processedAt.getTime())
    const orderNumbers = customerOrders.map((_, i) => i + 1)

    let has2nd = orderNumbers.some((n) => n >= 2)
    let has3rd = orderNumbers.some((n) => n >= 3)
    let has4th = orderNumbers.some((n) => n >= 4)

    if (has2nd) count2nd++
    if (has3rd) count3rd++
    if (has4th) count4th++

    let days1to2: number | null = null
    let days2to3: number | null = null
    let days3to4: number | null = null

    if (orderDates.length >= 2) {
      days1to2 = (orderDates[1]! - orderDates[0]!) / (1000 * 60 * 60 * 24)
      days1to2All.push(days1to2)
    }
    if (orderDates.length >= 3) {
      days2to3 = (orderDates[2]! - orderDates[1]!) / (1000 * 60 * 60 * 24)
      days2to3All.push(days2to3)
    }
    if (orderDates.length >= 4) {
      days3to4 = (orderDates[3]! - orderDates[2]!) / (1000 * 60 * 60 * 24)
      days3to4All.push(days3to4)
    }

    const customerMetrics: CustomerMetrics = {
      has2nd,
      has3rd,
      has4th,
      days1to2,
      days2to3,
      days3to4,
    }

    const groupKeys = new Set<string>()
    for (const li of firstOrderItems) {
      const product = li.productShopifyId
        ? productMap.get(li.productShopifyId) ?? null
        : null
      const identity = getGroupIdentity({
        groupBy,
        lineItem: li,
        product,
      })

      if (!identity.include || groupKeys.has(identity.key)) continue
      groupKeys.add(identity.key)

      if (!groupsToCustomers.has(identity.key)) {
        groupsToCustomers.set(identity.key, {
          id: identity.id,
          label: identity.label,
          groupBy,
          customers: new Map(),
        })
      }
      const entry = groupsToCustomers.get(identity.key)!
      entry.customers.set(cid, customerMetrics)
    }
  }

  const totalFirst = firstOrders.length
  const typical1to2 = pickMetric(days1to2All, params.metric)
  const summary: TimingsSummary = {
    firstOrders: totalFirst,
    secondOrdersPct: totalFirst > 0 ? (count2nd / totalFirst) * 100 : 0,
    thirdOrdersPct: totalFirst > 0 ? (count3rd / totalFirst) * 100 : 0,
    fourthOrdersPct: totalFirst > 0 ? (count4th / totalFirst) * 100 : 0,
    median1to2: typical1to2,
    median2to3: pickMetric(days2to3All, params.metric),
    median3to4: pickMetric(days3to4All, params.metric),
    reactivationDays: REACTIVATION_PCT_OF_1TO2 * typical1to2,
  }

  const groups: TimingsGroupRow[] = []
  for (const entry of groupsToCustomers.values()) {
    if (params.groupId && entry.id !== params.groupId) continue
    const customers = Array.from(entry.customers.values())
    const firstOrdersCount = customers.length
    const count2 = customers.filter((c) => c.has2nd).length
    const count3 = customers.filter((c) => c.has3rd).length
    const count4 = customers.filter((c) => c.has4th).length

    const d12 = customers.map((c) => c.days1to2).filter((d): d is number => d != null)
    const d23 = customers.map((c) => c.days2to3).filter((d): d is number => d != null)
    const d34 = customers.map((c) => c.days3to4).filter((d): d is number => d != null)
    const typical1to2Group = d12.length > 0 ? pickMetric(d12, params.metric) : null

    groups.push({
      id: entry.id,
      label: entry.label,
      groupBy: entry.groupBy,
      firstOrders: firstOrdersCount,
      secondOrdersPct: firstOrdersCount > 0 ? (count2 / firstOrdersCount) * 100 : 0,
      thirdOrdersPct: firstOrdersCount > 0 ? (count3 / firstOrdersCount) * 100 : 0,
      fourthOrdersPct: firstOrdersCount > 0 ? (count4 / firstOrdersCount) * 100 : 0,
      days1to2: typical1to2Group,
      days2to3: d23.length > 0 ? pickMetric(d23, params.metric) : null,
      days3to4: d34.length > 0 ? pickMetric(d34, params.metric) : null,
      reactivationDays: typical1to2Group != null ? REACTIVATION_PCT_OF_1TO2 * typical1to2Group : null,
    })
  }

  groups.sort((a, b) => b.firstOrders - a.firstOrders)

  return {
    summary,
    groups,
    currency: 'USD',
  }
}
