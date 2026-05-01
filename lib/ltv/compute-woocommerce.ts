/**
 * LTV / cohort metrics for WooCommerce — same response shape as `computeLtv` (Shopify).
 * Does not import or modify `lib/ltv/compute.ts`.
 */

import type { PrismaClient } from '@prisma/client'
import { getDailyVariableContribution } from '@/lib/workspace-costs'
import type { LtvDimension, LtvMetric, LtvMode, LtvResponse, LtvRow, LtvSummary } from './types'
import { normalizeCogsSettings, resolveLineItemCogs } from '@/lib/cogs'
import {
  isWoocommerceOrderIncluded,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import { ensureWooOrderTypesForOrderFilters } from '@/lib/integrations/woocommerce-sync'

function normEmail(e: string | null | undefined): string | null {
  if (e == null) return null
  const t = e.trim().toLowerCase()
  return t.length > 0 ? t : null
}

function applyMode(
  mode: LtvMode,
  firstOrder: number,
  firstOrderR: number,
  incr: number[],
  metric: LtvMetric
): {
  m1: number
  m2: number
  m3: number
  m4: number
  m5: number
  m6: number
  m7: number
  m8: number
  m9: number
  m10: number
  m11: number
  m12: number
} {
  const fo = metric === 'repeat_rate' ? 0 : firstOrderR
  if (mode === 'cumulative') {
    let s = fo
    return {
      m1: (s += incr[0]),
      m2: (s += incr[1]),
      m3: (s += incr[2]),
      m4: (s += incr[3]),
      m5: (s += incr[4]),
      m6: (s += incr[5]),
      m7: (s += incr[6]),
      m8: (s += incr[7]),
      m9: (s += incr[8]),
      m10: (s += incr[9]),
      m11: (s += incr[10]),
      m12: (s += incr[11]),
    }
  }
  if (mode === 'post_acq') {
    let s = 0
    return {
      m1: (s += incr[0]),
      m2: (s += incr[1]),
      m3: (s += incr[2]),
      m4: (s += incr[3]),
      m5: (s += incr[4]),
      m6: (s += incr[5]),
      m7: (s += incr[6]),
      m8: (s += incr[7]),
      m9: (s += incr[8]),
      m10: (s += incr[9]),
      m11: (s += incr[10]),
      m12: (s += incr[11]),
    }
  }
  return {
    m1: incr[0],
    m2: incr[1],
    m3: incr[2],
    m4: incr[3],
    m5: incr[4],
    m6: incr[5],
    m7: incr[6],
    m8: incr[7],
    m9: incr[8],
    m10: incr[9],
    m11: incr[10],
    m12: incr[11],
  }
}

function summaryFromMode(
  mode: LtvMode,
  firstOrder: number,
  firstOrderR: number,
  incr: number[]
): { month1: number; month3: number; month6: number; month12: number } {
  const applied = applyMode(mode, firstOrder, firstOrderR, incr, 'cm2')
  return {
    month1: applied.m1,
    month3: applied.m3,
    month6: applied.m6,
    month12: applied.m12,
  }
}

async function getDailyAdSpendWoo(
  prisma: PrismaClient,
  workspace: {
    meta_ads_connections: {
      id: string
      selected_ad_account_ids: string[] | null
      selected_ad_account_id: string | null
    } | null
    google_ads_connections: {
      id: string
      selected_customer_ids: string[] | null
      selected_customer_id: string | null
    } | null
  },
  fromDate: Date,
  toDate: Date
): Promise<Map<string, number>> {
  const byDate = new Map<string, number>()
  const meta = workspace.meta_ads_connections
  const google = workspace.google_ads_connections
  const metaIds = meta?.selected_ad_account_ids?.length
    ? meta.selected_ad_account_ids
    : meta?.selected_ad_account_id
      ? [meta.selected_ad_account_id]
      : undefined
  const googleIds = google?.selected_customer_ids?.length
    ? google.selected_customer_ids
    : google?.selected_customer_id
      ? [google.selected_customer_id]
      : undefined

  if (meta?.id) {
    const metaWhere: {
      connection_id: string
      date: { gte: Date; lte: Date }
      ad_account_id?: { in: string[] }
    } = {
      connection_id: meta.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (metaIds?.length) metaWhere.ad_account_id = { in: metaIds }
    const rows = await prisma.meta_ads_daily_metrics.groupBy({
      by: ['date'],
      where: metaWhere,
      _sum: { spend: true },
    })
    for (const r of rows) {
      const dateStr = r.date.toISOString().slice(0, 10)
      byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + Number(r._sum.spend ?? 0))
    }
  }
  if (google?.id) {
    const googleWhere: {
      connection_id: string
      date: { gte: Date; lte: Date }
      customer_id?: { in: string[] }
    } = {
      connection_id: google.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (googleIds?.length) googleWhere.customer_id = { in: googleIds }
    const rows = await prisma.google_ads_daily_metrics.groupBy({
      by: ['date'],
      where: googleWhere,
      _sum: { spend: true },
    })
    for (const r of rows) {
      const dateStr = r.date.toISOString().slice(0, 10)
      byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + Number(r._sum.spend ?? 0))
    }
  }
  return byDate
}

async function getWooDailyRatesLtv(
  prisma: PrismaClient,
  workspaceId: string,
  wooConnId: string,
  fromDate: Date,
  toDate: Date,
  storeCurrency: string,
  orderFilterSettings: { skippedShopifyOrderTags: string[]; skipZeroSalesOrders: boolean }
): Promise<Map<string, { ordersCount: number; grossSales: number; shipping: number; packaging: number; website: number; totalReturns: number }>> {
  const [allOrdersByDay, workspaceCosts] = await Promise.all([
    prisma.woocommerceOrder.findMany({
      where: {
        connectionId: wooConnId,
        dateCreated: { gte: fromDate, lte: toDate },
        status: { notIn: ['cancelled', 'failed', 'pending'] },
      },
      select: {
        dateCreated: true,
        total: true,
        totalRefund: true,
        orderType: true,
        rawJson: true,
      },
    }),
    prisma.workspaceCost.findMany({
      where: { workspaceId, effectiveFrom: { lte: toDate } },
    }),
  ])
  const ordersByDay = allOrdersByDay.filter((o) =>
    isWoocommerceOrderIncluded(
      { orderType: o.orderType, rawJson: o.rawJson, total: o.total },
      orderFilterSettings
    )
  )
  const dayAgg = new Map<string, { grossSales: number; ordersCount: number; totalReturns: number }>()
  for (const o of ordersByDay) {
    if (!o.dateCreated) continue
    const ds = o.dateCreated.toISOString().slice(0, 10)
    const cur = dayAgg.get(ds) ?? { grossSales: 0, ordersCount: 0, totalReturns: 0 }
    cur.grossSales += Number(o.total ?? 0)
    cur.ordersCount += 1
    cur.totalReturns += Number(o.totalRefund ?? 0)
    dayAgg.set(ds, cur)
  }

  const out = new Map<
    string,
    { ordersCount: number; grossSales: number; shipping: number; packaging: number; website: number; totalReturns: number }
  >()
  const cursor = new Date(fromDate.getTime())
  cursor.setUTCHours(0, 0, 0, 0)
  const end = new Date(toDate.getTime())
  end.setUTCHours(23, 59, 59, 999)
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10)
    const d = dayAgg.get(dateStr)
    const ordersCount = d?.ordersCount ?? 0
    const grossSales = d?.grossSales ?? 0
    const totalReturns = d?.totalReturns ?? 0
    let shipping = 0
    let packaging = 0
    let website = 0
    for (const cost of workspaceCosts) {
      const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
      const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
      if (dateStr < costFromStr || dateStr > costToStr) continue
      const contribution = getDailyVariableContribution(
        {
          costType: cost.costType,
          amount: Number(cost.amount),
          currency: cost.currency,
          isPercent: cost.isPercent,
          billingMode: cost.billingMode ?? 'monthly',
        },
        dateStr,
        ordersCount || 1,
        grossSales,
        storeCurrency
      )
      if (cost.costType === 'SHIPPING') shipping += contribution
      else if (cost.costType === 'PACKAGING') packaging += contribution
      else if (cost.costType === 'WEBSITE') website += contribution
    }
    out.set(dateStr, { ordersCount: ordersCount || 1, grossSales, shipping, packaging, website, totalReturns })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

async function getWooOrderCogs(
  prisma: PrismaClient,
  wooConnId: string,
  orderIds: string[],
  rawCogsSettings: { overrideAllCogsPercent: unknown; fallbackCogsPercent: unknown; cogsMarkupPercent: unknown } | null
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map()
  const [products, items] = await Promise.all([
    prisma.woocommerceProduct.findMany({
      where: { connectionId: wooConnId },
      select: { wcProductId: true, coq: true },
    }),
    prisma.woocommerceLineItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, productId: true, quantity: true, price: true },
    }),
  ])
  const coqMap = new Map(products.filter((p) => p.coq != null).map((p) => [String(p.wcProductId), Number(p.coq)]))
  const settings = normalizeCogsSettings(rawCogsSettings ?? null)
  const cogsByOrder = new Map<string, number>()
  for (const it of items) {
    const cogs = resolveLineItemCogs(
      {
        price: Number(it.price ?? 0),
        quantity: it.quantity ?? 0,
        productShopifyId: it.productId != null ? String(it.productId) : null,
      },
      coqMap,
      settings
    )
    cogsByOrder.set(it.orderId, (cogsByOrder.get(it.orderId) ?? 0) + cogs)
  }
  return cogsByOrder
}

type WooFirstRow = { customer_key: string; first_at: Date; order_id: string }

export async function computeWoocommerceLtv(
  prisma: PrismaClient,
  workspaceId: string,
  params: {
    from: string
    to: string
    metric: LtvMetric
    mode: LtvMode
    dimension: LtvDimension
    page: number
    pageSize: number
    search?: string
  }
): Promise<LtvResponse> {
  const wooConn = await prisma.woocommerceConnection.findFirst({
    where: { workspaceId, status: 'CONNECTED' },
    select: { id: true, currency: true },
  })
  if (!wooConn) {
    return {
      summary: {
        firstOrderR: 0,
        firstOrder: 0,
        month1: 0,
        month3: 0,
        month6: 0,
        month12: 0,
        newCustomers: 0,
      },
      rows: [],
      totalRows: 0,
      currency: 'USD',
    }
  }
  const storeCurrency = wooConn.currency ?? 'USD'

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      skipped_shopify_order_tags: true,
      skip_zero_sales_orders: true,
      cogsSettings: true,
      meta_ads_connections: {
        select: {
          id: true,
          selected_ad_account_ids: true,
          selected_ad_account_id: true,
        },
      },
      google_ads_connections: {
        select: {
          id: true,
          selected_customer_ids: true,
          selected_customer_id: true,
        },
      },
    },
  })
  if (!workspace) {
    return {
      summary: {
        firstOrderR: 0,
        firstOrder: 0,
        month1: 0,
        month3: 0,
        month6: 0,
        month12: 0,
        newCustomers: 0,
      },
      rows: [],
      totalRows: 0,
      currency: storeCurrency,
    }
  }

  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const toDateExtended = new Date(toDate)
  toDateExtended.setUTCDate(toDateExtended.getUTCDate() + 360)
  const orderFilterSettings = normalizeOrderFilterSettings({
    skippedShopifyOrderTags: workspace.skipped_shopify_order_tags ?? [],
    skipZeroSalesOrders: workspace.skip_zero_sales_orders ?? false,
  })
  await ensureWooOrderTypesForOrderFilters(wooConn.id, orderFilterSettings, { maxUpdates: 5000 })

  const allOrdersForFirst = await prisma.woocommerceOrder.findMany({
    where: {
      connectionId: wooConn.id,
      dateCreated: { lte: toDateExtended },
      customerEmail: { not: null },
      status: { notIn: ['cancelled', 'failed', 'pending'] },
    },
    select: {
      id: true,
      customerEmail: true,
      dateCreated: true,
      total: true,
      orderType: true,
      rawJson: true,
    },
    orderBy: [{ dateCreated: 'asc' }, { id: 'asc' }],
  })
  const ordersForFirst = allOrdersForFirst.filter((o) =>
    isWoocommerceOrderIncluded(
      { orderType: o.orderType, rawJson: o.rawJson, total: o.total },
      orderFilterSettings
    )
  )

  const firstByEmail = new Map<string, { firstAt: Date; orderId: string }>()
  for (const o of ordersForFirst) {
    const key = normEmail(o.customerEmail)
    if (!key || !o.dateCreated) continue
    if (!firstByEmail.has(key)) {
      firstByEmail.set(key, { firstAt: o.dateCreated, orderId: o.id })
    }
  }

  const firstOrders: WooFirstRow[] = []
  for (const [customer_key, v] of firstByEmail) {
    if (v.firstAt >= fromDate && v.firstAt <= toDate) {
      firstOrders.push({ customer_key, first_at: v.firstAt, order_id: v.orderId })
    }
  }

  if (firstOrders.length === 0) {
    return {
      summary: {
        firstOrderR: 0,
        firstOrder: 0,
        month1: 0,
        month3: 0,
        month6: 0,
        month12: 0,
        newCustomers: 0,
      },
      rows: [],
      totalRows: 0,
      currency: storeCurrency,
    }
  }

  const firstByCustomer = new Map<string, { firstAt: Date; orderId: string }>()
  for (const r of firstOrders) {
    firstByCustomer.set(r.customer_key, { firstAt: r.first_at, orderId: r.order_id })
  }

  const customerKeys = firstOrders.map((r) => r.customer_key)

  const [dailyRates, dailyAdSpend] = await Promise.all([
    getWooDailyRatesLtv(
      prisma,
      workspaceId,
      wooConn.id,
      fromDate,
      toDateExtended,
      storeCurrency,
      orderFilterSettings
    ),
    getDailyAdSpendWoo(prisma, workspace, fromDate, toDateExtended),
  ])

  const cohortSet = new Set(customerKeys)
  const allOrdersRawUnfiltered = await prisma.woocommerceOrder.findMany({
    where: {
      connectionId: wooConn.id,
      dateCreated: { gte: fromDate, lte: toDateExtended },
      customerEmail: { not: null },
      status: { notIn: ['cancelled', 'failed', 'pending'] },
    },
    include: { lineItems: true },
    orderBy: [{ dateCreated: 'asc' }, { id: 'asc' }],
  })
  const allOrdersRaw = allOrdersRawUnfiltered.filter((o) =>
    isWoocommerceOrderIncluded(
      { orderType: o.orderType, rawJson: o.rawJson, total: o.total },
      orderFilterSettings
    )
  )
  const orders = allOrdersRaw.filter((o) => {
    const k = normEmail(o.customerEmail)
    return k != null && cohortSet.has(k)
  })

  const orderCogsMap = await getWooOrderCogs(
    prisma,
    wooConn.id,
    orders.map((o) => o.id),
    workspace.cogsSettings ?? null
  )

  const productIds = [
    ...new Set(
      orders.flatMap((o) => (o.lineItems ?? []).map((li) => li.productId).filter((x): x is number => x != null))
    ),
  ]
  const products =
    productIds.length === 0
      ? []
      : await prisma.woocommerceProduct.findMany({
          where: { connectionId: wooConn.id, wcProductId: { in: productIds } },
          select: { wcProductId: true, name: true, sku: true },
        })
  const productMap = new Map(products.map((p) => [p.wcProductId, p]))

  const lineItemsByOrder = new Map<
    string,
    { productId: number | null; productTitle: string; variationId: number | null; price: number; quantity: number }[]
  >()
  for (const o of orders) {
    const list: {
      productId: number | null
      productTitle: string
      variationId: number | null
      price: number
      quantity: number
    }[] = []
    for (const li of o.lineItems ?? []) {
      const p = li.productId != null ? productMap.get(li.productId) : null
      list.push({
        productId: li.productId ?? null,
        productTitle: p?.name ?? li.name ?? li.sku ?? '—',
        variationId: li.variationId ?? null,
        price: Number(li.price ?? 0),
        quantity: li.quantity ?? 0,
      })
    }
    lineItemsByOrder.set(o.id, list)
  }

  type DimAgg = {
    customers: Set<string>
    sumFirstOrder: number
    sumFirstOrderR: number
    repeatByBucket: number[]
    repeatCustomersByBucket: Set<string>[]
    ordersCount: number
    dimensionLabel: string
  }

  const aggByDim = new Map<string, DimAgg>()
  function getOrCreate(key: string, label: string): DimAgg {
    let a = aggByDim.get(key)
    if (!a) {
      a = {
        customers: new Set(),
        sumFirstOrder: 0,
        sumFirstOrderR: 0,
        repeatByBucket: Array(12).fill(0),
        repeatCustomersByBucket: Array(12)
          .fill(null)
          .map(() => new Set<string>()),
        ordersCount: 0,
        dimensionLabel: label,
      }
      aggByDim.set(key, a)
    }
    return a
  }

  const effectiveDimension: LtvDimension =
    params.dimension === 'product' ||
    params.dimension === 'variant' ||
    params.dimension === 'customer_id'
      ? params.dimension
      : 'product'

  for (const order of orders) {
    const custKey = normEmail(order.customerEmail)
    const fo = custKey ? firstByCustomer.get(custKey) : null
    if (!fo) continue

    if (!order.dateCreated) continue
    const dateStr = order.dateCreated.toISOString().slice(0, 10)
    const rates = dailyRates.get(dateStr)
    const ordersThatDay = rates?.ordersCount ?? 1
    const perOrderShipping = (rates?.shipping ?? 0) / ordersThatDay
    const perOrderPackaging = (rates?.packaging ?? 0) / ordersThatDay
    const perOrderWebsite = (rates?.website ?? 0) / ordersThatDay
    const perOrderAdSpend = (dailyAdSpend.get(dateStr) ?? 0) / ordersThatDay
    const cogs = orderCogsMap.get(order.id) ?? 0
    const totalPrice = Number(order.total ?? 0)
    const cm2 = totalPrice - cogs - perOrderShipping - perOrderPackaging - perOrderWebsite - perOrderAdSpend
    const grossSales = rates?.grossSales ?? 0
    const totalReturns = rates?.totalReturns ?? 0
    const orderShareRefunds = grossSales > 0 ? (totalPrice / grossSales) * totalReturns : 0
    const cm2Realized = cm2 - orderShareRefunds
    const revenueRealized = totalPrice - orderShareRefunds
    const revenueOrig = totalPrice

    const isFirstOrder = order.id === fo.orderId
    const firstAt = fo.firstAt
    const daysDiff = (order.dateCreated.getTime() - firstAt.getTime()) / (1000 * 60 * 60 * 24)
    const bucket =
      isFirstOrder ? -1 : daysDiff >= 1 && daysDiff <= 360 ? Math.min(12, Math.floor((daysDiff - 1) / 30) + 1) : -1

    const lis = lineItemsByOrder.get(order.id) ?? []
    const orderTotal = totalPrice || 1
    const dimensionKeys: { key: string; label: string; weight: number }[] = []

    if (effectiveDimension === 'customer_id' && custKey) {
      dimensionKeys.push({ key: custKey, label: custKey, weight: 1 })
    } else if (effectiveDimension === 'product') {
      for (const li of lis) {
        const key = li.productId != null ? String(li.productId) : 'unknown'
        const label = li.productTitle
        const weight = (li.price * li.quantity) / orderTotal
        dimensionKeys.push({ key, label, weight })
      }
      if (dimensionKeys.length === 0) dimensionKeys.push({ key: '__no_product__', label: '—', weight: 1 })
    } else if (effectiveDimension === 'variant') {
      for (const li of lis) {
        const vKey = `${li.productId ?? 'unknown'}|${li.variationId ?? 'default'}`
        const label = li.productTitle
        const weight = (li.price * li.quantity) / orderTotal
        dimensionKeys.push({ key: vKey, label, weight })
      }
      if (dimensionKeys.length === 0) dimensionKeys.push({ key: '__no_variant__', label: '—', weight: 1 })
    } else {
      dimensionKeys.push({ key: '__unknown__', label: '—', weight: 1 })
    }

    const valueOrig = params.metric === 'cm2' ? cm2 : params.metric === 'revenue' ? revenueOrig : 1
    const valueRealized = params.metric === 'cm2' ? cm2Realized : params.metric === 'revenue' ? revenueRealized : 1
    const repeatValue = params.metric === 'repeat_rate' ? 1 : params.metric === 'cm2' ? cm2Realized : revenueRealized

    for (const { key, label, weight } of dimensionKeys) {
      const agg = getOrCreate(key, label)
      if (isFirstOrder && custKey) {
        agg.customers.add(custKey)
        agg.sumFirstOrder += valueOrig * weight
        agg.sumFirstOrderR += valueRealized * weight
      }
      agg.ordersCount += weight
      if (bucket >= 1 && bucket <= 12) {
        agg.repeatByBucket[bucket - 1] += repeatValue * weight
        if (params.metric === 'repeat_rate' && custKey) agg.repeatCustomersByBucket[bucket - 1].add(custKey)
      }
    }
  }

  const allRows: LtvRow[] = []
  for (const [dimKey, a] of aggByDim) {
    const n = a.customers.size
    if (n === 0) continue
    const firstOrder = params.metric === 'repeat_rate' ? 1 : a.sumFirstOrder / n
    const firstOrderR = params.metric === 'repeat_rate' ? 1 : a.sumFirstOrderR / n
    const incr =
      params.metric === 'repeat_rate'
        ? a.repeatCustomersByBucket.map((set) => set.size / n)
        : a.repeatByBucket.map((s) => s / n)
    const applied = applyMode(params.mode, firstOrder, firstOrderR, incr, params.metric)
    const ordersCount = Math.round(a.ordersCount)
    allRows.push({
      dimensionValue: dimKey,
      dimensionLabel: a.dimensionLabel,
      ordersCount,
      newCustomers: n,
      firstOrderR,
      firstOrder,
      ...applied,
    })
  }

  allRows.sort((a, b) => (b.dimensionLabel || '').localeCompare(a.dimensionLabel || ''))

  let filtered = allRows
  if (params.search && params.search.trim()) {
    const q = params.search.trim().toLowerCase()
    filtered = allRows.filter((r) => r.dimensionLabel.toLowerCase().includes(q))
  }

  const totalRows = filtered.length
  const start = (params.page - 1) * params.pageSize
  const paginated = filtered.slice(start, start + params.pageSize)

  const totalNewCustomers = firstOrders.length
  let sumFirstOrder = 0
  let sumFirstOrderR = 0
  const sumIncr = Array(12).fill(0)
  for (const r of allRows) {
    sumFirstOrder += r.firstOrder * r.newCustomers
    sumFirstOrderR += r.firstOrderR * r.newCustomers
    for (let k = 0; k < 12; k++) {
      const mk = (['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'] as const)[k]
      sumIncr[k] += r[mk] * r.newCustomers
    }
  }
  const avgFirstOrder = totalNewCustomers > 0 ? sumFirstOrder / totalNewCustomers : 0
  const avgFirstOrderR = totalNewCustomers > 0 ? sumFirstOrderR / totalNewCustomers : 0
  const avgIncr = sumIncr.map((s) => (totalNewCustomers > 0 ? s / totalNewCustomers : 0))
  const summaryBaseFo = params.metric === 'repeat_rate' ? 0 : avgFirstOrder
  const summaryBaseFoR = params.metric === 'repeat_rate' ? 0 : avgFirstOrderR
  const summaryCards = summaryFromMode(params.mode, summaryBaseFo, summaryBaseFoR, avgIncr)

  const summary: LtvSummary = {
    firstOrder: params.metric === 'repeat_rate' ? 1 : avgFirstOrder,
    firstOrderR: params.metric === 'repeat_rate' ? 1 : avgFirstOrderR,
    month1: params.metric === 'repeat_rate' ? avgIncr[0] : summaryCards.month1,
    month3: params.metric === 'repeat_rate' ? avgIncr[2] : summaryCards.month3,
    month6: params.metric === 'repeat_rate' ? avgIncr[5] : summaryCards.month6,
    month12: params.metric === 'repeat_rate' ? avgIncr[11] : summaryCards.month12,
    newCustomers: totalNewCustomers,
  }

  return {
    summary,
    rows: paginated,
    totalRows,
    currency: storeCurrency,
  }
}
