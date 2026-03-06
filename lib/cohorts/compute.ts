import type { PrismaClient } from '@prisma/client'
import { eachDayOfInterval, getDaysInMonth } from 'date-fns'
import type { CohortMetric, CohortMode, CohortRow, CohortsSummary } from './types'

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

export type WorkspaceForCohorts = {
  id: string
  shopifyConnections: { id: string }[]
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
}

type FirstOrderRow = { customer_shopify_id: string; first_at: Date; order_id: string }
type OrderWithCogs = { order_id: string; customer_shopify_id: string; processed_at: Date; total_price: number; cogs: number }
type RepeatRow = { order_id: string; customer_shopify_id: string; processed_at: Date; first_at: Date; bucket: number; total_price: number; cogs: number }

/** Daily per-order rates: shipping, packaging, website, misc (same logic as analytics) */
function buildDailyRates(
  prisma: PrismaClient,
  workspaceId: string,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  storeCurrency: string
): Promise<Map<string, { ordersCount: number; grossSales: number; shipping: number; packaging: number; website: number; misc: number }>> {
  return (async () => {
    const daily = await prisma.shopifyAnalyticsDaily.findMany({
      where: { connectionId, date: { gte: fromDate, lte: toDate } },
      select: { date: true, ordersCount: true, grossSales: true },
    })
    const workspaceCosts = await prisma.workspaceCost.findMany({
      where: { workspaceId, effectiveFrom: { lte: toDate } },
    })
    const miscExpenses = await prisma.workspaceMiscExpense.findMany({
      where: { workspaceId, effectiveStartDate: { lte: toDate } },
    })
    const map = new Map<string, { ordersCount: number; grossSales: number; shipping: number; packaging: number; website: number; misc: number }>()
    for (const d of daily) {
      const dateStr = d.date.toISOString().slice(0, 10)
      const ordersCount = d.ordersCount
      const grossSales = Number(d.grossSales)
      let shipping = 0,
        packaging = 0,
        website = 0
      for (const cost of workspaceCosts) {
        const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
        const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
        if (dateStr < costFromStr || dateStr > costToStr) continue
        const amount = convertCurrency(Number(cost.amount), cost.currency || 'USD', storeCurrency)
        if (cost.costType === 'SHIPPING') shipping += amount * ordersCount
        else if (cost.costType === 'PACKAGING') packaging += amount * ordersCount
        else if (cost.costType === 'WEBSITE') {
          if (cost.isPercent) website += (Number(cost.amount) / 100) * grossSales
          else website += amount * ordersCount
        }
      }
      const daysInMonth = getDaysInMonth(new Date(dateStr + 'T12:00:00.000Z'))
      let misc = 0
      for (const e of miscExpenses) {
        if (dateStr < e.effectiveStartDate.toISOString().slice(0, 10)) continue
        misc += convertCurrency(Number(e.amount), e.currency || 'INR', storeCurrency) / daysInMonth
      }
      map.set(dateStr, { ordersCount, grossSales, shipping, packaging, website, misc })
    }
    return map
  })()
}

/**
 * First order per customer GLOBALLY (all-time), then filter to those whose first_at is in [fromDate, toDate].
 * Cohort row = month of first_order_at; we only include cohorts where first_order_at ∈ [from, to].
 */
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

/** Order-level revenue and COGS for given order IDs */
async function getOrderCogs(
  prisma: PrismaClient,
  connectionId: string,
  orderIds: string[]
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map()
  const products = await prisma.shopifyProduct.findMany({
    where: { connectionId },
    select: { shopifyId: true, coq: true },
  })
  const coqMap = new Map(products.filter((p) => p.coq).map((p) => [p.shopifyId, Number(p.coq)]))
  const items = await prisma.shopifyLineItem.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, productShopifyId: true, quantity: true },
  })
  const cogsByOrder = new Map<string, number>()
  for (const it of items) {
    const coq = it.productShopifyId ? coqMap.get(it.productShopifyId) ?? 0 : 0
    cogsByOrder.set(it.orderId, (cogsByOrder.get(it.orderId) ?? 0) + coq * it.quantity)
  }
  return cogsByOrder
}

/** Daily total_returns and gross_sales by date (for First Order R: attribute refunds to first orders by day) */
async function getDailyReturnsAndSales(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<Map<string, { grossSales: number; totalReturns: number }>> {
  const rows = await prisma.shopifyAnalyticsDaily.findMany({
    where: { connectionId, date: { gte: fromDate, lte: toDate } },
    select: { date: true, grossSales: true, totalReturns: true },
  })
  const map = new Map<string, { grossSales: number; totalReturns: number }>()
  for (const r of rows) {
    const dateStr = r.date.toISOString().slice(0, 10)
    map.set(dateStr, {
      grossSales: Number(r.grossSales),
      totalReturns: Number(r.totalReturns ?? 0),
    })
  }
  return map
}

/** Total ad spend in [fromDate, toDate] — same logic as /analytics (aggregate Meta + Google, selected accounts) */
async function getTotalAdSpend(
  prisma: PrismaClient,
  workspace: WorkspaceForCohorts,
  fromDate: Date,
  toDate: Date
): Promise<number> {
  const meta = workspace.meta_ads_connections
  const google = workspace.google_ads_connections
  const metaIds = meta?.selected_ad_account_ids?.length ? meta.selected_ad_account_ids : meta?.selected_ad_account_id ? [meta.selected_ad_account_id] : undefined
  const googleIds = google?.selected_customer_ids?.length ? google.selected_customer_ids : google?.selected_customer_id ? [google.selected_customer_id] : undefined

  let metaAdSpend = 0
  let googleAdSpend = 0
  if (meta?.id) {
    const metaWhere: { connection_id: string; date: { gte: Date; lte: Date }; ad_account_id?: { in: string[] } } = {
      connection_id: meta.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (metaIds?.length) metaWhere.ad_account_id = { in: metaIds }
    const agg = await prisma.meta_ads_daily_metrics.aggregate({
      where: metaWhere as Parameters<typeof prisma.meta_ads_daily_metrics.aggregate>[0]['where'],
      _sum: { spend: true },
    })
    metaAdSpend = Number(agg._sum.spend ?? 0)
  }
  if (google?.id) {
    const googleWhere: { connection_id: string; date: { gte: Date; lte: Date }; customer_id?: { in: string[] } } = {
      connection_id: google.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (googleIds?.length) googleWhere.customer_id = { in: googleIds }
    const agg = await prisma.google_ads_daily_metrics.aggregate({
      where: googleWhere as Parameters<typeof prisma.google_ads_daily_metrics.aggregate>[0]['where'],
      _sum: { spend: true },
    })
    googleAdSpend = Number(agg._sum.spend ?? 0)
  }
  return metaAdSpend + googleAdSpend
}

/** Daily ad spend (Meta + Google, same filters as analytics) — for order-level CM3 = ... - Ad Spend - Misc */
async function getDailyAdSpend(
  prisma: PrismaClient,
  workspace: WorkspaceForCohorts,
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

/** Ad spend by month (Meta + Google, same filters as analytics) — for per-cohort CAC */
async function getAdSpendByMonth(
  prisma: PrismaClient,
  workspace: WorkspaceForCohorts,
  fromDate: Date,
  toDate: Date
): Promise<Map<string, number>> {
  const byMonth = new Map<string, number>()
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
      const month = r.date.toISOString().slice(0, 7)
      byMonth.set(month, (byMonth.get(month) ?? 0) + Number(r._sum.spend ?? 0))
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
      const month = r.date.toISOString().slice(0, 7)
      byMonth.set(month, (byMonth.get(month) ?? 0) + Number(r._sum.spend ?? 0))
    }
  }
  return byMonth
}

/** RTO order numbers (channel_order_id or order number) for realized adjustment */
async function getRtoOrderIdentifiers(
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
  const RTO_CODES = [9, 10, 14, 20, 40, 41, 46]
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

const BUCKET_DAYS = 30

/** Order date availability for the workspace's Shopify connection (for debugging cohort range). */
export async function getOrderDateStats(
  prisma: PrismaClient,
  connectionId: string,
  toDate: Date
): Promise<{
  minProcessedAt: string | null
  maxProcessedAt: string | null
  countOlder90: number
  countOlder180: number
  countOlder360: number
}> {
  const agg = await prisma.shopifyOrder.aggregate({
    where: { connectionId },
    _min: { processedAt: true },
    _max: { processedAt: true },
    _count: { id: true },
  })
  const minP = agg._min.processedAt
  const maxP = agg._max.processedAt
  const t = toDate.getTime()
  const d90 = new Date(t - 90 * 24 * 60 * 60 * 1000)
  const d180 = new Date(t - 180 * 24 * 60 * 60 * 1000)
  const d360 = new Date(t - 360 * 24 * 60 * 60 * 1000)
  const [c90, c180, c360] = await Promise.all([
    prisma.shopifyOrder.count({ where: { connectionId, processedAt: { lt: d90 } } }),
    prisma.shopifyOrder.count({ where: { connectionId, processedAt: { lt: d180 } } }),
    prisma.shopifyOrder.count({ where: { connectionId, processedAt: { lt: d360 } } }),
  ])
  return {
    minProcessedAt: minP ? minP.toISOString() : null,
    maxProcessedAt: maxP ? maxP.toISOString() : null,
    countOlder90: c90,
    countOlder180: c180,
    countOlder360: c360,
  }
}

export async function computeCohorts(
  prisma: PrismaClient,
  workspace: WorkspaceForCohorts,
  params: { from: string; to: string; metric: CohortMetric; mode: CohortMode }
): Promise<{ summary: CohortsSummary; rows: CohortRow[]; currency: string }> {
  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return {
      summary: { averageCac: 0, avg90DayRepeat: 0, averagePayback: null, newCustomers: 0 },
      rows: [],
      currency: 'USD',
    }
  }

  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const toDateExtended = new Date(toDate)
  toDateExtended.setUTCDate(toDateExtended.getUTCDate() + 360)

  const [firstOrders, dailyRates, adSpendByMonth, totalAdSpend, rtoIds, dailyReturnsAndSales, dailyAdSpend] = await Promise.all([
    getFirstOrders(prisma, connectionId, fromDate, toDate),
    buildDailyRates(prisma, workspace.id, connectionId, fromDate, toDateExtended, 'INR'),
    getAdSpendByMonth(prisma, workspace, fromDate, toDate),
    getTotalAdSpend(prisma, workspace, fromDate, toDate),
    getRtoOrderIdentifiers(prisma, workspace.id, connectionId, fromDate, toDateExtended),
    getDailyReturnsAndSales(prisma, connectionId, fromDate, toDateExtended),
    getDailyAdSpend(prisma, workspace, fromDate, toDateExtended),
  ])

  const firstByCustomer = new Map<string | null, { firstAt: Date; orderId: string }>()
  for (const r of firstOrders) {
    firstByCustomer.set(r.customer_shopify_id, { firstAt: r.first_at, orderId: r.order_id })
  }

  const cohortMonths = new Map<string, { customers: string[] }>()
  for (const r of firstOrders) {
    const month = r.first_at.toISOString().slice(0, 7)
    if (!cohortMonths.has(month)) cohortMonths.set(month, { customers: [] })
    cohortMonths.get(month)!.customers.push(r.customer_shopify_id)
  }

  const firstOrderIds = firstOrders.map((r) => r.order_id)
  const orders = await prisma.shopifyOrder.findMany({
    where: {
      connectionId,
      customerShopifyId: { in: firstOrders.map((r) => r.customer_shopify_id) },
      processedAt: { gte: fromDate, lte: toDateExtended },
    },
    select: { id: true, customerShopifyId: true, processedAt: true, totalPrice: true, orderNumber: true, name: true },
  })
  const orderCogsMap = await getOrderCogs(prisma, connectionId, orders.map((o) => o.id))
  const storeCurrency = 'INR'

  const firstOrderMetrics = new Map<string, { firstOrder: number; firstOrderR: number }>()
  const repeatByCohortBucket = new Map<string, Map<number, { sum: number; customers: Set<string>; orders: number }>>()
  /** CM3 bucket sums per cohort — used for payback (summary and row when metric=cm3) regardless of selected metric */
  const repeatByCohortBucketCm3 = new Map<string, Map<number, number>>()

  for (const month of cohortMonths.keys()) {
    repeatByCohortBucket.set(month, new Map())
    repeatByCohortBucketCm3.set(month, new Map())
    for (let k = 1; k <= 12; k++) {
      repeatByCohortBucket.get(month)!.set(k, { sum: 0, customers: new Set(), orders: 0 })
      repeatByCohortBucketCm3.get(month)!.set(k, 0)
    }
  }

  for (const order of orders) {
    const custId = order.customerShopifyId
    const fo = custId ? firstByCustomer.get(custId) : null
    if (!fo) continue
    const dateStr = order.processedAt.toISOString().slice(0, 10)
    const rates = dailyRates.get(dateStr)
    const cogs = orderCogsMap.get(order.id) ?? 0
    const totalPrice = Number(order.totalPrice)
    const ordersThatDay = rates?.ordersCount ?? 1
    const perOrderShipping = (rates?.shipping ?? 0) / ordersThatDay
    const perOrderPackaging = (rates?.packaging ?? 0) / ordersThatDay
    const perOrderWebsite = (rates?.website ?? 0) / ordersThatDay
    const perOrderMisc = (rates?.misc ?? 0) / ordersThatDay
    const perOrderAdSpend = (dailyAdSpend.get(dateStr) ?? 0) / ordersThatDay
    const cm1 = totalPrice - cogs - perOrderShipping - perOrderPackaging - perOrderWebsite
    const cm2 = cm1 - perOrderAdSpend
    const cm3 = cm2 - perOrderMisc
    const isRto = rtoIds.has(order.orderNumber) || rtoIds.has(order.name) || (order.name && rtoIds.has('#' + order.name))
    let realized: number
    if (isRto) {
      realized = 0
    } else {
      const daily = dailyReturnsAndSales.get(dateStr)
      const grossSales = daily?.grossSales ?? 0
      const totalReturns = daily?.totalReturns ?? 0
      const orderShareRefunds = grossSales > 0 ? (totalPrice / grossSales) * totalReturns : 0
      realized = cm3 - orderShareRefunds
    }
    const cohortMonth = fo.firstAt.toISOString().slice(0, 7)

    if (order.id === fo.orderId) {
      firstOrderMetrics.set(order.id, { firstOrder: cm3, firstOrderR: realized })
      continue
    }
    const firstAt = fo.firstAt
    const daysDiff = (order.processedAt.getTime() - firstAt.getTime()) / (1000 * 60 * 60 * 24)
    if (daysDiff < 1 || daysDiff > 360) continue
    const bucket = Math.min(12, Math.floor((daysDiff - 1) / 30) + 1)

    const rev = totalPrice
    const m = repeatByCohortBucket.get(cohortMonth)!.get(bucket)!
    repeatByCohortBucketCm3.get(cohortMonth)!.set(bucket, (repeatByCohortBucketCm3.get(cohortMonth)!.get(bucket) ?? 0) + cm3)
    if (params.metric === 'cm3') {
      m.sum += cm3
    } else if (params.metric === 'revenue') {
      m.sum += rev
    } else if (params.metric === 'repeat') {
      m.customers.add(custId!)
    } else if (params.metric === 'repurchase') {
      m.orders += 1
    }
  }

  const rows: CohortRow[] = []
  let totalNewCustomers = 0
  let repeat90Count = 0
  let paybackWeightedSum = 0
  let paybackWeight = 0

  for (const [cohortMonth, { customers }] of [...cohortMonths.entries()].sort()) {
    const newCustomers = customers.length
    totalNewCustomers += newCustomers
    const monthSpend = adSpendByMonth.get(cohortMonth) ?? 0
    const cac = newCustomers > 0 ? monthSpend / newCustomers : 0

    const firstOrderIdsForCohort = firstOrders.filter((r) => r.first_at.toISOString().slice(0, 7) === cohortMonth).map((r) => r.order_id)
    let sumFirstOrder = 0
    let sumFirstOrderR = 0
    for (const oid of firstOrderIdsForCohort) {
      const m = firstOrderMetrics.get(oid)
      if (m) {
        sumFirstOrder += m.firstOrder
        sumFirstOrderR += m.firstOrderR
      }
    }
    const firstOrder = newCustomers > 0 ? sumFirstOrder / newCustomers : 0
    const firstOrderR = newCustomers > 0 ? sumFirstOrderR / newCustomers : 0

    const bucketSums = repeatByCohortBucket.get(cohortMonth)!
    const bucketCm3 = repeatByCohortBucketCm3.get(cohortMonth)!
    const incr: number[] = []
    const incrCm3: number[] = []
    for (let k = 1; k <= 12; k++) {
      const b = bucketSums.get(k)!
      incrCm3.push((bucketCm3.get(k) ?? 0) / newCustomers)
      if (params.metric === 'cm3' || params.metric === 'revenue') incr.push(b.sum / newCustomers)
      else if (params.metric === 'repeat') incr.push(b.customers.size / newCustomers)
      else incr.push(b.orders / newCustomers)
    }

    let rr90 = 0
    if (newCustomers > 0) {
      let count90 = 0
      const ninetyMs = 90 * 24 * 60 * 60 * 1000
      for (const cid of customers) {
        const firstAt = firstByCustomer.get(cid)?.firstAt
        if (!firstAt) continue
        const t90 = firstAt.getTime() + ninetyMs
        const hasRepeat = orders.some(
          (o) =>
            o.customerShopifyId === cid &&
            o.id !== firstByCustomer.get(cid!)?.orderId &&
            o.processedAt.getTime() > firstAt.getTime() &&
            o.processedAt.getTime() <= t90
        )
        if (hasRepeat) count90++
      }
      rr90 = count90 / newCustomers
      repeat90Count += count90
    }

    const eps = 1e-9
    let payback: number | null = null
    if (params.metric === 'cm3' || params.metric === 'revenue') {
      const foVal = params.metric === 'cm3' ? firstOrderR : firstOrder
      let cum = foVal - cac
      if (cum >= 0) payback = 0
      else {
        for (let k = 1; k <= 12; k++) {
          const incrVal = incr[k - 1]
          const prevCum = cum
          cum += incrVal
          if (cum >= 0) {
            if (params.metric === 'cm3' && params.mode === 'post' && incrVal > eps && prevCum < 0) {
              payback = k - 1 + (0 - prevCum) / incrVal
            } else {
              payback = k
            }
            break
          }
        }
      }
    }
    const foValCm3 = firstOrderR
    let cumCm3 = foValCm3 - cac
    if (cumCm3 >= 0) {
      paybackWeightedSum += 0 * newCustomers
      paybackWeight += newCustomers
    } else {
      for (let k = 1; k <= 12; k++) {
        const incrVal = incrCm3[k - 1]
        const prevCum = cumCm3
        cumCm3 += incrVal
        if (cumCm3 >= 0) {
          if (incrVal > eps && prevCum < 0) {
            paybackWeightedSum += (k - 1 + (0 - prevCum) / incrVal) * newCustomers
          } else {
            paybackWeightedSum += k * newCustomers
          }
          paybackWeight += newCustomers
          break
        }
      }
    }

    let m1 = incr[0],
      m2 = incr[1],
      m3 = incr[2],
      m4 = incr[3],
      m5 = incr[4],
      m6 = incr[5],
      m7 = incr[6],
      m8 = incr[7],
      m9 = incr[8],
      m10 = incr[9],
      m11 = incr[10],
      m12 = incr[11]

    if (params.mode === 'post' && params.metric === 'revenue') {
      let s = 0
      m1 = (s += incr[0])
      m2 = (s += incr[1])
      m3 = (s += incr[2])
      m4 = (s += incr[3])
      m5 = (s += incr[4])
      m6 = (s += incr[5])
      m7 = (s += incr[6])
      m8 = (s += incr[7])
      m9 = (s += incr[8])
      m10 = (s += incr[9])
      m11 = (s += incr[10])
      m12 = (s += incr[11])
    } else if (params.mode === 'cumulative' && (params.metric === 'cm3' || params.metric === 'revenue')) {
      const foVal = params.metric === 'cm3' ? firstOrderR : firstOrder
      let s = foVal
      m1 = (s += incr[0])
      m2 = (s += incr[1])
      m3 = (s += incr[2])
      m4 = (s += incr[3])
      m5 = (s += incr[4])
      m6 = (s += incr[5])
      m7 = (s += incr[6])
      m8 = (s += incr[7])
      m9 = (s += incr[8])
      m10 = (s += incr[9])
      m11 = (s += incr[10])
      m12 = (s += incr[11])
    } else if (params.mode === 'pct' && (params.metric === 'cm3' || params.metric === 'revenue')) {
      const foVal = params.metric === 'cm3' ? firstOrderR : firstOrder
      const denom = Math.max(Math.abs(foVal), eps)
      let s = foVal
      m1 = ((s += incr[0]) / denom) * 100
      m2 = ((s += incr[1]) / denom) * 100
      m3 = ((s += incr[2]) / denom) * 100
      m4 = ((s += incr[3]) / denom) * 100
      m5 = ((s += incr[4]) / denom) * 100
      m6 = ((s += incr[5]) / denom) * 100
      m7 = ((s += incr[6]) / denom) * 100
      m8 = ((s += incr[7]) / denom) * 100
      m9 = ((s += incr[8]) / denom) * 100
      m10 = ((s += incr[9]) / denom) * 100
      m11 = ((s += incr[10]) / denom) * 100
      m12 = ((s += incr[11]) / denom) * 100
    } else if (params.mode === 'ltvcac' && (params.metric === 'cm3' || params.metric === 'revenue')) {
      const foVal = params.metric === 'cm3' ? firstOrderR : firstOrder
      const denom = Math.max(cac, eps)
      let s = foVal
      m1 = (s += incr[0]) / denom
      m2 = (s += incr[1]) / denom
      m3 = (s += incr[2]) / denom
      m4 = (s += incr[3]) / denom
      m5 = (s += incr[4]) / denom
      m6 = (s += incr[5]) / denom
      m7 = (s += incr[6]) / denom
      m8 = (s += incr[7]) / denom
      m9 = (s += incr[8]) / denom
      m10 = (s += incr[9]) / denom
      m11 = (s += incr[10]) / denom
      m12 = (s += incr[11]) / denom
    } else if (params.mode === 'post' && (params.metric === 'repeat' || params.metric === 'repurchase')) {
      let s = 0
      m1 = (s += incr[0])
      m2 = (s += incr[1])
      m3 = (s += incr[2])
      m4 = (s += incr[3])
      m5 = (s += incr[4])
      m6 = (s += incr[5])
      m7 = (s += incr[6])
      m8 = (s += incr[7])
      m9 = (s += incr[8])
      m10 = (s += incr[9])
      m11 = (s += incr[10])
      m12 = (s += incr[11])
    }
    // incr: m1..m12 already set for incremental (CM3+Post keeps incremental)

    if (params.metric === 'cm3' && params.mode === 'post' && rows.length === 0) {
      const paybackNote =
        payback === 0
          ? 'Immediate (First Order (R) >= CAC)'
          : payback != null
            ? `First Order (R) + M1+...+M${Math.ceil(payback)} >= CAC; interpolated = ${Number(payback).toFixed(1)} mo`
            : 'Not reached'
      console.log('[Cohort CM3+Post DEBUG]', {
        cohortMonth,
        newCustomers,
        cac,
        originalFirstOrderCm3Avg: firstOrder,
        realizedFirstOrderCm3Avg: firstOrderR,
        m1: incr[0],
        m2: incr[1],
        m3: incr[2],
        miscellaneousFixedCostsIncluded: true,
        payback,
        paybackFormatted: payback != null ? (payback === 0 ? 'Immediate' : `${Number(payback).toFixed(1)} mo`) : '—',
        paybackCalculation: paybackNote,
        formulaNote: 'CM3 = Net Revenue (order) - COGS - Variable - Ad Spend - Misc; Realized = CM3 - refund share',
      })
    }

    rows.push({
      cohortMonth,
      newCustomers,
      cac,
      rr90,
      payback,
      firstOrder,
      firstOrderR,
      m1: m1 ?? 0,
      m2: m2 ?? 0,
      m3: m3 ?? 0,
      m4: m4 ?? 0,
      m5: m5 ?? 0,
      m6: m6 ?? 0,
      m7: m7 ?? 0,
      m8: m8 ?? 0,
      m9: m9 ?? 0,
      m10: m10 ?? 0,
      m11: m11 ?? 0,
      m12: m12 ?? 0,
    })
  }

  const avg90 = totalNewCustomers > 0 ? repeat90Count / totalNewCustomers : 0
  const avgPayback = paybackWeight > 0 ? paybackWeightedSum / paybackWeight : null
  const averageCac = totalNewCustomers > 0 ? totalAdSpend / totalNewCustomers : 0

  const summary: CohortsSummary = {
    averageCac,
    avg90DayRepeat: avg90,
    averagePayback: avgPayback,
    newCustomers: totalNewCustomers,
  }

  return { summary, rows, currency: storeCurrency }
}
