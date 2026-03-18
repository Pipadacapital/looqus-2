import type { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { getDaysInMonth } from 'date-fns'
import { getDailyVariableContribution } from '@/lib/workspace-costs'
import type { LtvDimension, LtvMetric, LtvMode, LtvRow, LtvSummary } from './types'
import { fetchCustomerFirstOrdersInRange } from '@/lib/metrics'
import { getOrderInclusionWhere, normalizeOrderFilterSettings } from '@/lib/order-filters'
import { getEffectiveDailyAggregates } from '@/lib/effective-daily'
import { resolveLineItemCogs, normalizeCogsSettings } from '@/lib/cogs'

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  INR: 83.5,
  EUR: 0.92,
  GBP: 0.79,
  AUD: 1.53,
  CAD: 1.35,
}

function convertCurrency(amount: number, from: string, to: string) {
  if (!from || !to || from === to) return amount
  const fromRate = EXCHANGE_RATES[from] || 1
  const toRate = EXCHANGE_RATES[to] || 1
  return (amount / fromRate) * toRate
}

export type WorkspaceForLtv = {
  id: string
  shopifyConnections: { id: string }[]
  cogsSettings?: {
    overrideAllCogsPercent: unknown
    fallbackCogsPercent: unknown
    cogsMarkupPercent: unknown
  } | null
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
  shiprocketConnection: { id: string; status: string } | null
  skippedShopifyOrderTags?: string[] | null
  skipZeroSalesOrders?: boolean | null
}

async function getDailyRates(
  prisma: PrismaClient,
  workspaceId: string,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  storeCurrency: string,
  orderInclusionWhere?: Prisma.ShopifyOrderWhereInput
): Promise<Map<string, { ordersCount: number; grossSales: number; shipping: number; packaging: number; website: number }>> {
  const effective = await getEffectiveDailyAggregates(
    prisma,
    connectionId,
    fromDate,
    toDate,
    orderInclusionWhere
  )
  const workspaceCosts = await prisma.workspaceCost.findMany({
    where: { workspaceId, effectiveFrom: { lte: toDate } },
  })
  const map = new Map<string, { ordersCount: number; grossSales: number; shipping: number; packaging: number; website: number }>()
  for (const [dateStr, d] of effective) {
    const ordersCount = d.ordersCount
    const grossSales = d.grossSales
    let shipping = 0,
      packaging = 0,
      website = 0
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
        ordersCount,
        grossSales,
        storeCurrency
      )
      if (cost.costType === 'SHIPPING') shipping += contribution
      else if (cost.costType === 'PACKAGING') packaging += contribution
      else if (cost.costType === 'WEBSITE') website += contribution
    }
    map.set(dateStr, { ordersCount, grossSales, shipping, packaging, website })
  }
  return map
}

async function getDailyAdSpend(
  prisma: PrismaClient,
  workspace: WorkspaceForLtv,
  fromDate: Date,
  toDate: Date
): Promise<Map<string, number>> {
  const byDate = new Map<string, number>()
  const meta = workspace.meta_ads_connections
  const google = workspace.google_ads_connections
  const metaIds = meta?.selected_ad_account_ids?.length ? meta.selected_ad_account_ids : meta?.selected_ad_account_id ? [meta.selected_ad_account_id] : undefined
  const googleIds = google?.selected_customer_ids?.length ? google.selected_customer_ids : google?.selected_customer_id ? [google.selected_customer_id] : undefined

  if (meta?.id) {
    const metaWhere: { connection_id: string; date: { gte: Date; lte: Date }; ad_account_id?: { in: string[] } } = {
      connection_id: meta.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (metaIds?.length) metaWhere.ad_account_id = { in: metaIds }
    const rows = await prisma.meta_ads_daily_metrics.groupBy({
      by: ['date'],
      where: metaWhere as Parameters<typeof prisma.meta_ads_daily_metrics.groupBy>[0]['where'],
      _sum: { spend: true },
    })
    for (const r of rows) {
      const dateStr = r.date.toISOString().slice(0, 10)
      byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + Number(r._sum.spend ?? 0))
    }
  }
  if (google?.id) {
    const googleWhere: { connection_id: string; date: { gte: Date; lte: Date }; customer_id?: { in: string[] } } = {
      connection_id: google.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (googleIds?.length) googleWhere.customer_id = { in: googleIds }
    const rows = await prisma.google_ads_daily_metrics.groupBy({
      by: ['date'],
      where: googleWhere as Parameters<typeof prisma.google_ads_daily_metrics.groupBy>[0]['where'],
      _sum: { spend: true },
    })
    for (const r of rows) {
      const dateStr = r.date.toISOString().slice(0, 10)
      byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + Number(r._sum.spend ?? 0))
    }
  }
  return byDate
}

async function getDailyReturnsAndSales(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  orderInclusionWhere?: Prisma.ShopifyOrderWhereInput
): Promise<Map<string, { grossSales: number; totalReturns: number }>> {
  const effective = await getEffectiveDailyAggregates(
    prisma,
    connectionId,
    fromDate,
    toDate,
    orderInclusionWhere
  )
  const map = new Map<string, { grossSales: number; totalReturns: number }>()
  for (const [dateStr, d] of effective) {
    map.set(dateStr, { grossSales: d.grossSales, totalReturns: d.totalReturns })
  }
  return map
}

async function getOrderCogs(
  prisma: PrismaClient,
  connectionId: string,
  orderIds: string[],
  rawCogsSettings: WorkspaceForLtv['cogsSettings']
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map()
  const [products, items] = await Promise.all([
    prisma.shopifyProduct.findMany({
      where: { connectionId },
      select: { shopifyId: true, coq: true },
    }),
    prisma.shopifyLineItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, productShopifyId: true, quantity: true, price: true },
    }),
  ])
  const coqMap = new Map(products.filter((p) => p.coq).map((p) => [p.shopifyId, Number(p.coq)]))
  const settings = normalizeCogsSettings(rawCogsSettings ?? null)
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

const RTO_CODES = [9, 10, 14, 20, 40, 41, 46]

async function getRtoOrderIds(
  prisma: PrismaClient,
  workspaceId: string,
  connectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<Set<string>> {
  const sr = await prisma.shiprocketConnection.findUnique({
    where: { workspaceId },
    select: { id: true, status: true },
  })
  if (!sr || sr.status !== 'CONNECTED') return new Set()
  const shipments = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId: sr.id,
      shippedAt: { gte: fromDate, lte: toDate },
      OR: [
        { trackingStatusCode: { in: RTO_CODES } },
        { statusCode: { in: RTO_CODES } },
      ],
    },
    select: { channelOrderId: true },
  })
  const ids = new Set<string>()
  for (const s of shipments) {
    if (s.channelOrderId && s.channelOrderId !== '') {
      ids.add(s.channelOrderId)
      ids.add(s.channelOrderId.replace(/^#/, ''))
    }
  }
  return ids
}

/** Apply mode to incremental M1..M12 and first-order to get display values */
function applyMode(
  mode: LtvMode,
  firstOrder: number,
  firstOrderR: number,
  incr: number[],
  metric: LtvMetric
): { m1: number; m2: number; m3: number; m4: number; m5: number; m6: number; m7: number; m8: number; m9: number; m10: number; m11: number; m12: number } {
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

/** Summary card values from mode: 1 Month = M1 display, 3 Months = M3 display, etc. */
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

export async function computeLtv(
  prisma: PrismaClient,
  workspace: WorkspaceForLtv,
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
): Promise<{ summary: LtvSummary; rows: LtvRow[]; totalRows: number; currency: string }> {
  const connectionId = workspace.shopifyConnections[0]?.id
  const storeCurrency = 'INR'
  if (!connectionId) {
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

  const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)
  const orderInclusionWhere = getOrderInclusionWhere(orderFilterSettings)

  const [firstOrders, dailyRates, dailyAdSpend, dailyReturnsAndSales, rtoIds] = await Promise.all([
    fetchCustomerFirstOrdersInRange(prisma, connectionId, fromDate, toDate, orderFilterSettings),
    getDailyRates(prisma, workspace.id, connectionId, fromDate, toDateExtended, storeCurrency, orderInclusionWhere),
    getDailyAdSpend(prisma, workspace, fromDate, toDateExtended),
    getDailyReturnsAndSales(prisma, connectionId, fromDate, toDateExtended, orderInclusionWhere),
    getRtoOrderIds(prisma, workspace.id, connectionId, fromDate, toDateExtended),
  ])

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
    firstByCustomer.set(r.customer_shopify_id, { firstAt: r.first_at, orderId: r.order_id })
  }

  const customerIds = firstOrders.map((r) => r.customer_shopify_id)
  const orders = await prisma.shopifyOrder.findMany({
    where: {
      connectionId,
      customerShopifyId: { in: customerIds },
      processedAt: { gte: fromDate, lte: toDateExtended },
      ...orderInclusionWhere,
    },
    select: {
      id: true,
      customerShopifyId: true,
      processedAt: true,
      totalPrice: true,
      orderNumber: true,
      name: true,
      totalDiscount: true,
      subtotalPrice: true,
      tags: true,
    },
  })

  const orderCogsMap = await getOrderCogs(prisma, connectionId, orders.map((o) => o.id), workspace.cogsSettings ?? null)

  const lineItemsByOrder = new Map<string, { productShopifyId: string | null; productTitle: string; variantTitle: string | null; price: number; quantity: number }[]>()
  const lineItems = await prisma.shopifyLineItem.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    select: { orderId: true, productShopifyId: true, title: true, variantTitle: true, price: true, quantity: true },
  })
  const productIds = [...new Set(lineItems.map((li) => li.productShopifyId).filter(Boolean))] as string[]
  const products = await prisma.shopifyProduct.findMany({
    where: { connectionId, shopifyId: { in: productIds } },
    select: { shopifyId: true, title: true, vendor: true, productType: true, tags: true },
  })
  const productMap = new Map(products.map((p) => [p.shopifyId, p]))

  for (const li of lineItems) {
    const list = lineItemsByOrder.get(li.orderId) ?? []
    const product = li.productShopifyId ? productMap.get(li.productShopifyId) : null
    list.push({
      productShopifyId: li.productShopifyId,
      productTitle: product?.title ?? li.title,
      variantTitle: li.variantTitle,
      price: Number(li.price),
      quantity: li.quantity,
    })
    lineItemsByOrder.set(li.orderId, list)
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

  for (const order of orders) {
    const custId = order.customerShopifyId
    const fo = custId ? firstByCustomer.get(custId) : null
    if (!fo) continue

    const dateStr = order.processedAt.toISOString().slice(0, 10)
    const rates = dailyRates.get(dateStr)
    const ordersThatDay = rates?.ordersCount ?? 1
    const perOrderShipping = (rates?.shipping ?? 0) / ordersThatDay
    const perOrderPackaging = (rates?.packaging ?? 0) / ordersThatDay
    const perOrderWebsite = (rates?.website ?? 0) / ordersThatDay
    const perOrderAdSpend = (dailyAdSpend.get(dateStr) ?? 0) / ordersThatDay
    const cogs = orderCogsMap.get(order.id) ?? 0
    const totalPrice = Number(order.totalPrice)
    const cm2 = totalPrice - cogs - perOrderShipping - perOrderPackaging - perOrderWebsite - perOrderAdSpend
    const isRto = rtoIds.has(order.orderNumber) || rtoIds.has(order.name) || (order.name && rtoIds.has('#' + order.name))
    const daily = dailyReturnsAndSales.get(dateStr)
    const grossSales = daily?.grossSales ?? 0
    const totalReturns = daily?.totalReturns ?? 0
    const orderShareRefunds = grossSales > 0 ? (totalPrice / grossSales) * totalReturns : 0
    const cm2Realized = isRto ? 0 : cm2 - orderShareRefunds
    const revenueRealized = isRto ? 0 : totalPrice - orderShareRefunds
    const revenueOrig = totalPrice

    const isFirstOrder = order.id === fo.orderId
    const firstAt = fo.firstAt
    const daysDiff = (order.processedAt.getTime() - firstAt.getTime()) / (1000 * 60 * 60 * 24)
    const bucket = isFirstOrder ? -1 : (daysDiff >= 1 && daysDiff <= 360 ? Math.min(12, Math.floor((daysDiff - 1) / 30) + 1) : -1)

    const lis = lineItemsByOrder.get(order.id) ?? []
    const orderTotal = totalPrice || 1
    const orderTags = (order as { tags?: string[] }).tags ?? []
    const subtotal = Number((order as { subtotalPrice?: unknown }).subtotalPrice) || orderTotal
    const totalDiscount = Number((order as { totalDiscount?: unknown }).totalDiscount) || 0
    const discountPct = subtotal > 0 ? Math.round((totalDiscount / subtotal) * 100) : 0
    const dimensionKeys: { key: string; label: string; weight: number }[] = []

    if (params.dimension === 'customer_id' && custId) {
      dimensionKeys.push({ key: custId, label: custId, weight: 1 })
    } else if (params.dimension === 'product') {
      for (const li of lis) {
        const key = li.productShopifyId ?? 'unknown'
        const label = li.productTitle
        const weight = (li.price * li.quantity) / orderTotal
        dimensionKeys.push({ key, label, weight })
      }
      if (dimensionKeys.length === 0) dimensionKeys.push({ key: '__no_product__', label: '—', weight: 1 })
    } else if (params.dimension === 'variant') {
      for (const li of lis) {
        const vKey = (li.productShopifyId ?? '') + '|' + (li.variantTitle ?? 'default')
        const label = `${li.productTitle}${li.variantTitle ? ` - ${li.variantTitle}` : ''}`
        const weight = (li.price * li.quantity) / orderTotal
        dimensionKeys.push({ key: vKey, label, weight })
      }
      if (dimensionKeys.length === 0) dimensionKeys.push({ key: '__no_variant__', label: '—', weight: 1 })
    } else if (params.dimension === 'vendor') {
      for (const li of lis) {
        const product = li.productShopifyId ? productMap.get(li.productShopifyId) : null
        const vendor = product?.vendor ?? '—'
        const key = vendor || '__no_vendor__'
        const weight = (li.price * li.quantity) / orderTotal
        dimensionKeys.push({ key, label: vendor || '—', weight })
      }
      if (dimensionKeys.length === 0) dimensionKeys.push({ key: '__no_vendor__', label: '—', weight: 1 })
    } else if (params.dimension === 'product_type') {
      for (const li of lis) {
        const product = li.productShopifyId ? productMap.get(li.productShopifyId) : null
        const pt = product?.productType ?? '—'
        const key = pt || '__no_type__'
        const weight = (li.price * li.quantity) / orderTotal
        dimensionKeys.push({ key, label: pt || '—', weight })
      }
      if (dimensionKeys.length === 0) dimensionKeys.push({ key: '__no_type__', label: '—', weight: 1 })
    } else if (params.dimension === 'product_tags') {
      for (const li of lis) {
        const product = li.productShopifyId ? productMap.get(li.productShopifyId) : null
        const tags = product?.tags ?? []
        const weight = (li.price * li.quantity) / orderTotal / Math.max(tags.length || 1, 1)
        for (const tag of tags) {
          dimensionKeys.push({ key: tag, label: tag, weight })
        }
      }
      if (dimensionKeys.length === 0) dimensionKeys.push({ key: '__no_tag__', label: '—', weight: 1 })
    } else if (params.dimension === 'order_tags') {
      for (const tag of orderTags) {
        dimensionKeys.push({ key: tag, label: tag, weight: 1 })
      }
      if (dimensionKeys.length === 0) dimensionKeys.push({ key: '__no_tag__', label: '—', weight: 1 })
    } else if (params.dimension === 'discount_pct') {
      const bucket = discountPct <= 0 ? '0%' : discountPct <= 10 ? '1-10%' : discountPct <= 20 ? '11-20%' : '21%+'
      dimensionKeys.push({ key: bucket, label: bucket, weight: 1 })
    } else if (params.dimension === 'discount_codes' || params.dimension === 'collection') {
      dimensionKeys.push({ key: '—', label: '—', weight: 1 })
    } else {
      dimensionKeys.push({ key: '__unknown__', label: '—', weight: 1 })
    }

    const valueOrig = params.metric === 'cm2' ? cm2 : params.metric === 'revenue' ? revenueOrig : 1
    const valueRealized = params.metric === 'cm2' ? cm2Realized : params.metric === 'revenue' ? revenueRealized : 1
    const repeatValue = params.metric === 'repeat_rate' ? 1 : params.metric === 'cm2' ? cm2Realized : revenueRealized

    for (const { key, label, weight } of dimensionKeys) {
      const agg = getOrCreate(key, label)
      if (isFirstOrder) {
        agg.customers.add(custId!)
        agg.sumFirstOrder += valueOrig * weight
        agg.sumFirstOrderR += valueRealized * weight
      }
      agg.ordersCount += weight
      if (bucket >= 1 && bucket <= 12) {
        agg.repeatByBucket[bucket - 1] += repeatValue * weight
        if (params.metric === 'repeat_rate' && custId) agg.repeatCustomersByBucket[bucket - 1].add(custId)
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
      const key = (['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'] as const)[k]
      sumIncr[k] += r[key] * r.newCustomers
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
