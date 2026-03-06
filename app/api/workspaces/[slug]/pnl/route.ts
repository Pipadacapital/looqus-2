import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { getDaysInMonth } from 'date-fns'
import { getBuckets, getBucketUtcDateStrings, allocateMonthlyToBucket, type Granularity } from '@/lib/pnl/buckets'
import { totalChargesFromRaw } from '@/lib/shiprocket-charges'

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

export type PnLRow = {
  bucketKey: string
  label: string
  grossSales: number
  discounts: number
  sales: number
  netSales: number
  productGross: number
  shippingGross: number
  productDiscount: number
  shippingDiscount: number
  productNet: number
  shippingNet: number
  refunds: number
  productRefunds: number
  shippingRefunds: number
  returnFees: number
  revenue: number
  ncNetRevenue: number
  ecNetRevenue: number
  netRevenue: number
  cogs: number
  variableCosts: number
  shippingCosts: number
  returnsCosts: number
  paymentCosts: number
  customsCosts: number
  otherVariable: number
  adSpend: number
  metaAdSpend: number
  googleAdSpend: number
  contributionMargin1: number
  contributionMargin2: number
  contributionMargin3: number
  fixedCosts: number
  founderSalaryAllocated: number
  netProfit: number
  ordersCount: number
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const granularityParam = (searchParams.get('granularity') || 'day') as Granularity
  const granularity = ['day', 'week', 'month', 'quarter'].includes(granularityParam)
    ? granularityParam
    : 'day'

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
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
      shiprocketConnection: { select: { id: true, status: true } },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return NextResponse.json({ rows: [], currency: 'INR' })
  }

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const defaultFrom = new Date(today)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 364)
  const fromStr = fromParam ?? defaultFrom.toISOString().slice(0, 10)
  const toStr = toParam ?? todayStr

  const fromDate = new Date(`${fromStr}T00:00:00.000Z`)
  const toDate = new Date(`${toStr}T23:59:59.999Z`)

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range', rows: [], currency: 'INR' }, { status: 400 })
  }

  const storeCurrency = 'INR'

  // Load all data in parallel
  const [
    dailyAnalytics,
    workspaceCosts,
    miscExpenses,
    products,
    lineItemsInRange,
    metaAdDaily,
    googleAdDaily,
    shiprocketShipments,
    allOrdersInRange,
  ] = await Promise.all([
    prisma.shopifyAnalyticsDaily.findMany({
      where: { connectionId, date: { gte: fromDate, lte: toDate } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        netSales: true,
        grossSales: true,
        totalTax: true,
        totalDiscount: true,
        ordersCount: true,
        currency: true,
        totalReturns: true,
        returns: true,
      },
    }),
    prisma.workspaceCost.findMany({
      where: { workspaceId: workspace.id, effectiveFrom: { lte: toDate } },
    }),
    prisma.workspaceMiscExpense.findMany({
      where: { workspaceId: workspace.id, effectiveStartDate: { lte: toDate } },
    }),
    prisma.shopifyProduct.findMany({
      where: { connectionId },
      select: { shopifyId: true, coq: true },
    }),
    prisma.shopifyLineItem.findMany({
      where: {
        connectionId,
        order: { processedAt: { gte: fromDate, lte: toDate } },
      },
      select: {
        productShopifyId: true,
        quantity: true,
        order: { select: { id: true, processedAt: true } },
      },
    }),
    workspace.meta_ads_connections?.id
      ? prisma.meta_ads_daily_metrics.findMany({
          where: {
            connection_id: workspace.meta_ads_connections.id,
            date: { gte: fromDate, lte: toDate },
            ...(workspace.meta_ads_connections.selected_ad_account_ids?.length
              ? { ad_account_id: { in: workspace.meta_ads_connections.selected_ad_account_ids } }
              : workspace.meta_ads_connections.selected_ad_account_id
                ? { ad_account_id: workspace.meta_ads_connections.selected_ad_account_id }
                : {}),
          },
          select: { date: true, spend: true },
        })
      : Promise.resolve([]),
    workspace.google_ads_connections?.id
      ? prisma.google_ads_daily_metrics.findMany({
          where: {
            connection_id: workspace.google_ads_connections.id,
            date: { gte: fromDate, lte: toDate },
            ...(workspace.google_ads_connections.selected_customer_ids?.length
              ? { customer_id: { in: workspace.google_ads_connections.selected_customer_ids } }
              : workspace.google_ads_connections.selected_customer_id
                ? { customer_id: workspace.google_ads_connections.selected_customer_id }
                : {}),
          },
          select: { date: true, spend: true },
        })
      : Promise.resolve([]),
    workspace.shiprocketConnection?.id && workspace.shiprocketConnection?.status === 'CONNECTED'
      ? prisma.shiprocketShipment.findMany({
          where: { connectionId: workspace.shiprocketConnection.id },
          select: { shippedAt: true, shiprocketCreatedAt: true, rawJson: true },
        })
      : Promise.resolve([]),
    prisma.shopifyOrder.findMany({
      where: {
        connectionId,
        processedAt: { gte: fromDate, lte: toDate },
      },
      select: {
        id: true,
        customerShopifyId: true,
        processedAt: true,
        totalPrice: true,
        totalTax: true,
      },
    }),
  ])

  const coqMap = new Map(products.filter((p) => p.coq).map((p) => [p.shopifyId, Number(p.coq)]))

  // Daily COGS by date
  const dailyCogs = new Map<string, number>()
  for (const li of lineItemsInRange) {
    const coq = li.productShopifyId ? coqMap.get(li.productShopifyId) ?? 0 : 0
    const cogs = coq * li.quantity
    const dateStr = li.order.processedAt.toISOString().slice(0, 10)
    dailyCogs.set(dateStr, (dailyCogs.get(dateStr) ?? 0) + cogs)
  }

  // Daily total_returns and returns from Shopify-derived fields (shopify_analytics_daily).
  // P&L formulas: refunds = total_returns, productRefunds = returns, shippingRefunds = total_returns - returns.
  const dailyTotalReturns = new Map<string, number>()
  const dailyReturns = new Map<string, number>()
  for (const d of dailyAnalytics) {
    const dateStr = d.date.toISOString().slice(0, 10)
    dailyTotalReturns.set(dateStr, Number(d.totalReturns ?? 0))
    dailyReturns.set(dateStr, Number(d.returns ?? 0))
  }

  // Daily ad spend (total + Meta + Google)
  const dailyAdSpend = new Map<string, number>()
  const dailyMetaAdSpend = new Map<string, number>()
  const dailyGoogleAdSpend = new Map<string, number>()
  for (const r of metaAdDaily) {
    const d = r.date.toISOString().slice(0, 10)
    const spend = Number(r.spend)
    dailyMetaAdSpend.set(d, (dailyMetaAdSpend.get(d) ?? 0) + spend)
    dailyAdSpend.set(d, (dailyAdSpend.get(d) ?? 0) + spend)
  }
  for (const r of googleAdDaily) {
    const d = r.date.toISOString().slice(0, 10)
    const spend = Number(r.spend)
    dailyGoogleAdSpend.set(d, (dailyGoogleAdSpend.get(d) ?? 0) + spend)
    dailyAdSpend.set(d, (dailyAdSpend.get(d) ?? 0) + spend)
  }

  // First order per customer (all-time) for NC/EC
  const firstOrderByCustomer = await prisma.$queryRaw<
    { customer_shopify_id: string; first_at: Date }[]
  >`
    SELECT customer_shopify_id, MIN(processed_at) AS first_at
    FROM shopify_orders
    WHERE connection_id = ${connectionId}::uuid
      AND customer_shopify_id IS NOT NULL
      AND customer_shopify_id != ''
    GROUP BY customer_shopify_id
  `
  const firstAtMap = new Map(firstOrderByCustomer.map((r) => [r.customer_shopify_id, r.first_at]))

  // NC/EC revenue by bucket: for each order in range, is it first? attribute (total_price - total_tax) to bucket
  const bucketNcRevenue = new Map<string, number>()
  const bucketEcRevenue = new Map<string, number>()

  const founderMonthly =
    workspace.founderSalaryMonthly != null ? Number(workspace.founderSalaryMonthly) : 0
  const founderCurrency = workspace.founderSalaryCurrency ?? 'INR'

  const buckets = getBuckets(fromDate, toDate, granularity)
  const bucketByKey = new Map(buckets.map((b) => [b.key, b]))

  for (const order of allOrdersInRange) {
    const orderDate = order.processedAt
    const dateStr = orderDate.toISOString().slice(0, 10)
    const rev = Number(order.totalPrice) - Number(order.totalTax)
    const custId = order.customerShopifyId
    const firstAt = custId ? firstAtMap.get(custId) : null
    const isFirst = firstAt != null && orderDate.getTime() === firstAt.getTime()

    let bucketKey: string | null = null
    for (const b of buckets) {
      if (orderDate >= b.start && orderDate <= b.end) {
        bucketKey = b.key
        break
      }
    }
    if (!bucketKey) continue

    if (isFirst) {
      bucketNcRevenue.set(bucketKey, (bucketNcRevenue.get(bucketKey) ?? 0) + rev)
    } else {
      bucketEcRevenue.set(bucketKey, (bucketEcRevenue.get(bucketKey) ?? 0) + rev)
    }
  }

  // Shipping costs (Shiprocket): For each month bucket, we use the previous FULL month's average
  // shipping cost per order and multiply by the current bucket's order count. This is deterministic
  // and documented because Shiprocket data is not real-time; using previous month's avg avoids
  // missing or delayed data for the current period.
  const monthPrevAvg = new Map<string, number>() // month key (yyyy-mm) -> avg shipping per order
  if (shiprocketShipments.length > 0) {
    const shipmentsByMonth = new Map<string, { totalCharges: number; orderCount: number }>()
    const orderCountByMonth = new Map<string, number>()
    for (const d of dailyAnalytics) {
      const ym = d.date.toISOString().slice(0, 7)
      orderCountByMonth.set(ym, (orderCountByMonth.get(ym) ?? 0) + d.ordersCount)
    }
    for (const s of shiprocketShipments) {
      const at = s.shippedAt ?? s.shiprocketCreatedAt
      if (!at) continue
      const ym = at.toISOString().slice(0, 7)
      const total = totalChargesFromRaw(s.rawJson)
      const cur = shipmentsByMonth.get(ym) ?? { totalCharges: 0, orderCount: 0 }
      cur.totalCharges += total
      cur.orderCount += 1
      shipmentsByMonth.set(ym, cur)
    }
    const sortedMonths = Array.from(shipmentsByMonth.keys()).sort()
    for (let i = 1; i < sortedMonths.length; i++) {
      const prevMonth = sortedMonths[i - 1]
      const currMonth = sortedMonths[i]
      const prev = shipmentsByMonth.get(prevMonth)
      const prevOrders = orderCountByMonth.get(prevMonth) ?? 1
      if (prev && prevOrders > 0) {
        const avg = prev.totalCharges / prevOrders
        monthPrevAvg.set(currMonth, avg)
      }
    }
  }

  const rows: PnLRow[] = []

  for (const bucket of buckets) {
    const dateStrings = getBucketUtcDateStrings(bucket)

    let grossSales = 0
    let totalDiscount = 0
    let totalTaxBucket = 0
    let ordersCount = 0
    let cogs = 0
    let adSpend = 0
    let metaAdSpend = 0
    let googleAdSpend = 0
    let variableCosts = 0
    let fixedCosts = 0

    for (const dateStr of dateStrings) {
      const daily = dailyAnalytics.find((d) => d.date.toISOString().slice(0, 10) === dateStr)
      const dayOrders = daily?.ordersCount ?? 0
      const dayGross = daily ? Number(daily.grossSales) : 0
      if (daily) {
        grossSales += Number(daily.grossSales)
        totalDiscount += Number(daily.totalDiscount)
        totalTaxBucket += Number(daily.totalTax)
        ordersCount += daily.ordersCount
      }
      cogs += dailyCogs.get(dateStr) ?? 0
      adSpend += dailyAdSpend.get(dateStr) ?? 0
      metaAdSpend += dailyMetaAdSpend.get(dateStr) ?? 0
      googleAdSpend += dailyGoogleAdSpend.get(dateStr) ?? 0

      for (const cost of workspaceCosts) {
        const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
        const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
        if (dateStr >= costFromStr && dateStr <= costToStr) {
          const amt = convertCurrency(Number(cost.amount), cost.currency || 'USD', storeCurrency)
          if (cost.costType === 'SHIPPING') variableCosts += amt * dayOrders
          else if (cost.costType === 'PACKAGING') variableCosts += amt * dayOrders
          else if (cost.costType === 'WEBSITE') {
            if (cost.isPercent) variableCosts += (Number(cost.amount) / 100) * dayGross
            else variableCosts += amt * dayOrders
          } else if (cost.costType === 'CUSTOM') variableCosts += amt * dayOrders
        }
      }

      const dayDate = new Date(dateStr + 'T12:00:00.000Z')
      const daysInMonth = getDaysInMonth(dayDate)
      for (const e of miscExpenses) {
        if (dateStr >= e.effectiveStartDate.toISOString().slice(0, 10)) {
          fixedCosts += convertCurrency(Number(e.amount), e.currency || 'INR', storeCurrency) / daysInMonth
        }
      }
    }

    let totalReturnsBucket = 0
    let returnsBucket = 0
    for (const dateStr of dateStrings) {
      totalReturnsBucket += dailyTotalReturns.get(dateStr) ?? 0
      returnsBucket += dailyReturns.get(dateStr) ?? 0
    }
    const refunds = totalReturnsBucket
    const productRefunds = returnsBucket
    const shippingRefunds = totalReturnsBucket - returnsBucket

    // Net Sales = Sales - Discounts (displayed values; do not subtract refunds here; normalize discount sign)
    const sales = grossSales
    const discounts = totalDiscount
    const discountsAmount = Math.abs(discounts)
    const netSales = sales - discountsAmount
    // Revenue = Sales - Refunds (refunds as positive amount)
    const refundsAmount = Math.abs(refunds)
    const revenue = sales - refundsAmount
    // Net Revenue = Revenue - Taxes (taxes as positive amount)
    const taxesAmount = Math.abs(totalTaxBucket)
    const ncNetRevenue = bucketNcRevenue.get(bucket.key) ?? 0
    const ecNetRevenue = bucketEcRevenue.get(bucket.key) ?? 0
    const netRevenue = revenue - taxesAmount

    const bucketMonthKey = bucket.start.toISOString().slice(0, 7)
    const prevMonthAvg = monthPrevAvg.get(bucketMonthKey) ?? 0
    const shippingCosts = prevMonthAvg * ordersCount

    const founderAllocated = allocateMonthlyToBucket(
      convertCurrency(founderMonthly, founderCurrency, storeCurrency),
      bucket,
      fromDate,
      toDate
    )

    const cm1 = netSales - cogs - variableCosts
    const cm2 = cm1 - adSpend
    const cm3 = cm2 - fixedCosts
    const netProfit = cm3 - founderAllocated

    // [P&L DEBUG] one day row (first day bucket) — remove after verification
    if (granularity === 'day' && rows.length === 0) {
      console.log('[P&L DEBUG] day row:', {
        bucketDate: bucket.key,
        sales: grossSales,
        discounts: totalDiscount,
        refunds,
        taxes: totalTaxBucket,
        netSales,
        revenue,
        netRevenue,
      })
    }

    rows.push({
      bucketKey: bucket.key,
      label: bucket.label,
      grossSales,
      discounts: totalDiscount,
      sales: grossSales,
      netSales,
      productGross: grossSales,
      shippingGross: 0,
      productDiscount: totalDiscount,
      shippingDiscount: 0,
      productNet: netSales,
      shippingNet: 0,
      refunds,
      productRefunds,
      shippingRefunds,
      returnFees: 0,
      revenue,
      ncNetRevenue,
      ecNetRevenue,
      netRevenue,
      cogs,
      variableCosts,
      shippingCosts,
      returnsCosts: 0,
      paymentCosts: 0,
      customsCosts: 0,
      otherVariable: 0,
      adSpend,
      metaAdSpend,
      googleAdSpend,
      contributionMargin1: cm1,
      contributionMargin2: cm2,
      contributionMargin3: cm3,
      fixedCosts,
      founderSalaryAllocated: founderAllocated,
      netProfit,
      ordersCount,
    })
  }

  return NextResponse.json({
    rows,
    currency: storeCurrency,
  })
}
