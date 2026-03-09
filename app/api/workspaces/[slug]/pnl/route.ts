import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { getDaysInMonth } from 'date-fns'
import { getBuckets, getBucketUtcDateStrings, allocateMonthlyToBucket, type Granularity } from '@/lib/pnl/buckets'
import { totalChargesFromRaw } from '@/lib/shiprocket-charges'
import {
  getOrderInclusionWhereFromWorkspace,
  getFilteredDailyAggregates,
  hasNoOrderFilters,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import { computeLineItemsCogs, normalizeCogsSettings } from '@/lib/cogs'
import { getDailyVariableContribution } from '@/lib/workspace-costs'

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

  const connectionId = workspace.shopifyConnections?.[0]?.id ?? null
  if (!connectionId) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[P&L] No Shopify connection', { workspaceId: workspace.id, slug })
    }
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
  const orderFilterSettings = normalizeOrderFilterSettings(workspace)
  const orderInclusionWhere = getOrderInclusionWhereFromWorkspace(workspace)

  // Load all data in parallel (orders and line items respect workspace order filters)
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
    filteredDaily,
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
        total_returns: true,
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
        order: {
          connectionId,
          processedAt: { gte: fromDate, lte: toDate },
          ...orderInclusionWhere,
        },
      },
      select: {
        productShopifyId: true,
        quantity: true,
        price: true,
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
        ...orderInclusionWhere,
      },
      select: {
        id: true,
        customerShopifyId: true,
        processedAt: true,
        totalPrice: true,
        totalTax: true,
        totalDiscount: true,
      },
    }),
    hasNoOrderFilters(orderFilterSettings)
      ? Promise.resolve(new Map<string, { grossSales: number; ordersCount: number }>())
      : getFilteredDailyAggregates(prisma, connectionId, fromDate, toDate, orderFilterSettings),
  ])

  // Diagnostic: workspace and source row counts (temporary for debugging new-workspace issues)
  if (process.env.NODE_ENV === 'development') {
    const ordersCount = allOrdersInRange.length
    const dailyCount = dailyAnalytics.length
    console.log('[P&L] workspace scope', {
      workspaceId: workspace.id,
      slug,
      connectionId,
      dailyAnalyticsRows: dailyCount,
      ordersInRange: ordersCount,
      lineItemsInRange: lineItemsInRange.length,
      bucketsCount: 0,
    })
  }

  // Fallback: when shopify_analytics_daily is empty but we have orders, derive daily totals from orders
  // so P&L shows data for newly onboarded workspaces that haven't run analytics sync yet.
  let effectiveDaily = dailyAnalytics
  if (effectiveDaily.length === 0 && allOrdersInRange.length > 0) {
    const byDate = new Map<
      string,
      { grossSales: number; totalDiscount: number; totalTax: number; ordersCount: number; total_returns: number; returns: number }
    >()
    for (const o of allOrdersInRange) {
      const dateStr = o.processedAt.toISOString().slice(0, 10)
      const cur = byDate.get(dateStr) ?? {
        grossSales: 0,
        totalDiscount: 0,
        totalTax: 0,
        ordersCount: 0,
        total_returns: 0,
        returns: 0,
      }
      cur.grossSales += Number(o.totalPrice)
      cur.totalDiscount += Number(o.totalDiscount ?? 0)
      cur.totalTax += Number(o.totalTax)
      cur.ordersCount += 1
      byDate.set(dateStr, cur)
    }
    effectiveDaily = [...byDate.entries()].map(([dateStr, v]) => ({
      date: new Date(dateStr + 'T00:00:00.000Z'),
      netSales: v.grossSales - Math.abs(v.totalDiscount),
      grossSales: v.grossSales,
      totalTax: v.totalTax,
      totalDiscount: v.totalDiscount,
      ordersCount: v.ordersCount,
      currency: storeCurrency,
      total_returns: 0,
      returns: 0,
    }))
    if (process.env.NODE_ENV === 'development') {
      console.log('[P&L] fallback: derived daily from orders', { days: effectiveDaily.length })
    }
  }

  const coqMap = new Map(products.filter((p) => p.coq).map((p) => [p.shopifyId, Number(p.coq)]))
  const cogsSettings = normalizeCogsSettings(workspace.cogsSettings)
  const lineItemsWithDate = lineItemsInRange.map((li) => ({
    price: Number(li.price),
    quantity: li.quantity,
    productShopifyId: li.productShopifyId,
    orderProcessedAt: li.order.processedAt,
  }))
  const { dailyCogs } = computeLineItemsCogs(lineItemsWithDate, coqMap, cogsSettings, {
    logSampleSource: process.env.NODE_ENV === 'development' ? 'pnl' : undefined,
  })

  // Daily total_returns and returns from Shopify-derived fields (shopify_analytics_daily).
  // P&L formulas: refunds = total_returns, productRefunds = returns, shippingRefunds = total_returns - returns.
  const dailyTotalReturns = new Map<string, number>()
  const dailyReturns = new Map<string, number>()
  for (const d of effectiveDaily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    dailyTotalReturns.set(dateStr, Number(d.total_returns ?? 0))
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

  // First order per customer (from filtered orders in range) for NC/EC
  const firstAtMap = new Map<string, Date>()
  for (const order of allOrdersInRange) {
    const cid = order.customerShopifyId
    if (!cid || cid === '') continue
    const existing = firstAtMap.get(cid)
    if (!existing || order.processedAt < existing) {
      firstAtMap.set(cid, order.processedAt)
    }
  }

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
    for (const d of effectiveDaily) {
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
      const filtered = filteredDaily.get(dateStr)
      const daily = effectiveDaily.find((d) => d.date.toISOString().slice(0, 10) === dateStr)
      const dayOrders = filtered
        ? filtered.ordersCount
        : (daily?.ordersCount ?? 0)
      const dayGross = filtered
        ? filtered.grossSales
        : (daily ? Number(daily.grossSales) : 0)
      if (filtered) {
        grossSales += filtered.grossSales
        ordersCount += filtered.ordersCount
      } else if (daily) {
        grossSales += Number(daily.grossSales)
        ordersCount += daily.ordersCount
      }
      if (daily) {
        totalDiscount += Number(daily.totalDiscount)
        totalTaxBucket += Number(daily.totalTax)
      }
      cogs += dailyCogs.get(dateStr) ?? 0
      adSpend += dailyAdSpend.get(dateStr) ?? 0
      metaAdSpend += dailyMetaAdSpend.get(dateStr) ?? 0
      googleAdSpend += dailyGoogleAdSpend.get(dateStr) ?? 0

      for (const cost of workspaceCosts) {
        const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
        const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
        if (dateStr >= costFromStr && dateStr <= costToStr) {
          variableCosts += getDailyVariableContribution(
            {
              costType: cost.costType,
              amount: Number(cost.amount),
              currency: cost.currency,
              isPercent: cost.isPercent,
              billingMode: cost.billingMode ?? 'monthly',
            },
            dateStr,
            dayOrders,
            dayGross,
            storeCurrency
          )
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

  if (process.env.NODE_ENV === 'development') {
    console.log('[P&L] response', {
      slug,
      bucketCount: buckets.length,
      rowsReturned: rows.length,
      firstThree: rows.slice(0, 3).map((r) => ({ key: r.bucketKey, sales: r.sales, orders: r.ordersCount })),
    })
  }

  return NextResponse.json({
    rows,
    currency: storeCurrency,
  })
}
