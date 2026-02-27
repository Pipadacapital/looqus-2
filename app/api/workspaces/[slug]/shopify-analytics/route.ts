import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

// MVP Exchange Rates (Fallback to standard if a live API isn't used)
const EXCHANGE_RATES: Record<string, number> = {
  'USD': 1,
  'INR': 83.5,
  'EUR': 0.92,
  'GBP': 0.79,
  'AUD': 1.53,
  'CAD': 1.35,
}

function convertCurrency(amount: number, from: string, to: string) {
  if (!from || !to || from === to) return amount
  const fromRate = EXCHANGE_RATES[from] || 1
  const toRate = EXCHANGE_RATES[to] || 1
  return (amount / fromRate) * toRate
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
// s
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
      meta_ads_connections: { select: { id: true } },
      google_ads_connections: { select: { id: true } },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return NextResponse.json({
      daily: [],
      summary: null,
      error: null,
    })
  }

  // Work purely with date-only strings to avoid timezone off-by-one issues.
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10) // YYYY-MM-DD in UTC
  const defaultFromDate = new Date(today)
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29)
  const defaultFromStr = defaultFromDate.toISOString().slice(0, 10)

  const fromStr = fromParam ?? defaultFromStr
  const toStr = toParam ?? todayStr

  // Construct UTC midnights from the date strings.
  const fromDate = new Date(`${fromStr}T00:00:00.000Z`)
  const toDate = new Date(`${toStr}T23:59:59.999Z`)

  // Debug logging for date range and timezone behavior
  // This helps verify that a UI range like 2025-02-20..2025-02-23
  // is interpreted correctly on the server.


  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range', daily: [], summary: null }, { status: 400 })
  }

  const daily = await prisma.shopifyAnalyticsDaily.findMany({
    where: {
      connectionId,
      date: { gte: fromDate, lte: toDate },
    },
    orderBy: { date: 'asc' },
    select: {
      date: true,
      netSales: true,
      grossSales: true,
      totalTax: true,
      totalDiscount: true,
      ordersCount: true,
      aov: true,
      currency: true,
      sessions: true,
      conversionRate: true,
    },
  })

  

  // Calculate COGS
  const products = await prisma.shopifyProduct.findMany({
    where: { connectionId },
    select: { shopifyId: true, coq: true },
  })
  const coqMap = new Map()
  for (const p of products) {
    if (p.coq) {
      coqMap.set(p.shopifyId, Number(p.coq))
    }
  }

  const lineItems = await prisma.shopifyLineItem.findMany({
    where: {
      connectionId,
      order: {
        processedAt: { gte: fromDate, lte: toDate },
      },
    },
    select: {
      productShopifyId: true,
      quantity: true,
      order: { select: { processedAt: true } },
    },
  })

  let totalCogs = 0
  const dailyCogs = new Map<string, number>()
  for (const item of lineItems) {
    const coq = item.productShopifyId ? (coqMap.get(item.productShopifyId) || 0) : 0
    const itemCog = coq * item.quantity
    totalCogs += itemCog

    const dateStr = item.order.processedAt.toISOString().slice(0, 10)
    dailyCogs.set(dateStr, (dailyCogs.get(dateStr) || 0) + itemCog)
  }

  // Calculate other costs based on WorkspaceCost
  const workspaceCosts = await prisma.workspaceCost.findMany({
    where: {
      workspaceId: workspace.id,
      effectiveFrom: { lte: toDate },
    },
  })

  const totalNetSales = daily.reduce((sum, d) => sum + Number(d.netSales), 0)
  const totalGrossSales = daily.reduce((sum, d) => sum + Number(d.grossSales), 0)
  const totalTax = daily.reduce((sum, d) => sum + Number(d.totalTax), 0)
  const totalDiscount = daily.reduce((sum, d) => sum + Number(d.totalDiscount), 0)
  const totalOrders = daily.reduce((sum, d) => sum + d.ordersCount, 0)
  const storeCurrency = daily[0]?.currency ?? 'USD'

  // Prepaid orders %: orders with financial status "Paid" (prepaid) vs total
  const orderCounts = await prisma.shopifyOrder.groupBy({
    by: ['financialStatus'],
    where: {
      connectionId,
      processedAt: { gte: fromDate, lte: toDate },
    },
    _count: { id: true },
  })
  let prepaidOrdersCount = 0
  let ordersTotalForPrepaid = 0
  for (const g of orderCounts) {
    ordersTotalForPrepaid += g._count.id
    if (g.financialStatus?.toLowerCase() === 'paid') prepaidOrdersCount += g._count.id
  }
  const prepaidPercentage =
    ordersTotalForPrepaid > 0
      ? Math.round((prepaidOrdersCount / ordersTotalForPrepaid) * 10000) / 100
      : null

  // Sessions and conversion rate (from daily rows that have them)
  let totalSessions: number | null = null
  let conversionRatePeriod: number | null = null
  const dailyWithSessions = daily.filter((d) => d.sessions != null && Number(d.sessions) > 0)
  if (dailyWithSessions.length > 0) {
    totalSessions = dailyWithSessions.reduce((s, d) => s + (d.sessions ?? 0), 0)
    const sumConv = dailyWithSessions.reduce(
      (s, d) => s + (d.conversionRate != null ? Number(d.conversionRate) : 0),
      0
    )
    conversionRatePeriod =
      dailyWithSessions.length > 0 ? sumConv / dailyWithSessions.length : null
  } else {
    const anyConversion = daily.filter((d) => d.conversionRate != null)
    if (anyConversion.length > 0) {
      conversionRatePeriod =
        anyConversion.reduce((s, d) => s + Number(d.conversionRate!), 0) /
        anyConversion.length
    }
  }

  // Ad spend for the date range (Meta + Google)
  let metaAdSpend = 0
  let googleAdSpend = 0
  const metaConnectionId = workspace.meta_ads_connections?.id
  const googleConnectionId = workspace.google_ads_connections?.id

  if (metaConnectionId) {
    const metaAgg = await prisma.meta_ads_daily_metrics.aggregate({
      where: {
        connection_id: metaConnectionId,
        date: { gte: fromDate, lte: toDate },
      },
      _sum: { spend: true },
    })
    metaAdSpend = Number(metaAgg._sum.spend ?? 0)
  }

  const metaAdRows = metaConnectionId
    ? await prisma.meta_ads_daily_metrics.findMany({
        where: {
          connection_id: metaConnectionId,
          date: { gte: fromDate, lte: toDate },
        },
        select: {
          date: true,
          ad_account_id: true,
          campaign_id: true,
          campaign_name: true,
          spend: true,
        },
        orderBy: { date: 'asc' },
      })
    : []

  console.log('[shopify-analytics] Meta Ads – date range & spend', {
    from: fromStr,
    to: toStr,
    connectionId: metaConnectionId ?? null,
    totalSpend: metaAdSpend,
    rowCount: metaAdRows.length,
  })
  console.log('[shopify-analytics] Meta Ads – all rows in date range', {
    from: fromStr,
    to: toStr,
    rows: metaAdRows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      ad_account_id: r.ad_account_id,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      spend: Number(r.spend),
    })),
  })

  if (googleConnectionId) {
    const googleAgg = await prisma.google_ads_daily_metrics.aggregate({
      where: {
        connection_id: googleConnectionId,
        date: { gte: fromDate, lte: toDate },
      },
      _sum: { spend: true },
    })
    googleAdSpend = Number(googleAgg._sum.spend ?? 0)
  }

  const googleAdRows = googleConnectionId
    ? await prisma.google_ads_daily_metrics.findMany({
        where: {
          connection_id: googleConnectionId,
          date: { gte: fromDate, lte: toDate },
        },
        select: {
          date: true,
          customer_id: true,
          campaign_id: true,
          campaign_name: true,
          spend: true,
        },
        orderBy: { date: 'asc' },
      })
    : []

  console.log('[shopify-analytics] Google Ads – date range & spend', {
    from: fromStr,
    to: toStr,
    connectionId: googleConnectionId ?? null,
    totalSpend: googleAdSpend,
    rowCount: googleAdRows.length,
  })
  console.log('[shopify-analytics] Google Ads – all rows in date range', {
    from: fromStr,
    to: toStr,
    rows: googleAdRows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      customer_id: r.customer_id,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      spend: Number(r.spend),
    })),
  })

  const totalAdSpend = metaAdSpend + googleAdSpend

  let totalShipping = 0
  let totalPackaging = 0
  let totalWebsiteCharges = 0
  const dailyCosts = new Map<string, { shipping: number; packaging: number; website: number }>()

  for (const d of daily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    const ordersCount = d.ordersCount

    let dayShippingInfo = 0
    let dayPackagingInfo = 0
    let dayWebsiteInfo = 0

    for (const cost of workspaceCosts) {
      const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
      const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
      
      if (dateStr >= costFromStr && dateStr <= costToStr) {
        // Convert Workspace Cost currency to Shopify target currency
        const valInStoreCurrency = convertCurrency(Number(cost.amount), cost.currency || 'USD', storeCurrency)
        
        if (cost.costType === 'SHIPPING') dayShippingInfo += valInStoreCurrency
        else if (cost.costType === 'PACKAGING') dayPackagingInfo += valInStoreCurrency
        else if (cost.costType === 'WEBSITE') dayWebsiteInfo += valInStoreCurrency 
      }
    }

    const dayShipping = dayShippingInfo * ordersCount
    const dayPackaging = dayPackagingInfo * ordersCount
    const dayWebsite = dayWebsiteInfo * ordersCount

    totalShipping += dayShipping
    totalPackaging += dayPackaging
    totalWebsiteCharges += dayWebsite

    dailyCosts.set(dateStr, {
      shipping: dayShipping,
      packaging: dayPackaging,
      website: dayWebsite,
    })
  }

  // Assuming Product COGS is stored in Store's native currency by default.
  // If COGS needs conversion later, it can be applied around the `coqMap`.

  const totalCm1 = totalNetSales - totalCogs - totalShipping - totalPackaging - totalWebsiteCharges

  const summary = {
    totalNetSales,
    totalGrossSales,
    totalTax,
    totalDiscount,
    totalOrders,
    avgAov: totalOrders > 0 ? totalNetSales / totalOrders : 0,
    totalCogs,
    totalShipping,
    totalPackaging,
    totalWebsiteCharges,
    cm1: totalCm1,
    cm2: totalCm1 - totalAdSpend,
    currency: storeCurrency,
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    prepaidPercentage,
    totalSessions,
    conversionRate: conversionRatePeriod,
    metaAdSpend: metaAdSpend,
    googleAdSpend: googleAdSpend,
    totalAdSpend: totalAdSpend,
    acos:
      totalNetSales > 0
        ? Math.round((totalAdSpend / totalNetSales) * 10000) / 100
        : null,
  }

  return NextResponse.json({
    daily: daily.map((d) => {
      const dateStr = d.date.toISOString().slice(0, 10)
      const dayCogs = dailyCogs.get(dateStr) || 0
      const dCosts = dailyCosts.get(dateStr) || { shipping: 0, packaging: 0, website: 0 }
      const netSales = Number(d.netSales)
      const cm1 = netSales - dayCogs - dCosts.shipping - dCosts.packaging - dCosts.website

      return {
        date: dateStr,
        netSales,
        grossSales: Number(d.grossSales),
        totalTax: Number(d.totalTax),
        totalDiscount: Number(d.totalDiscount),
        ordersCount: d.ordersCount,
        aov: Number(d.aov),
        cogs: dayCogs,
        shipping: dCosts.shipping,
        packaging: dCosts.packaging,
        websiteCharges: dCosts.website,
        cm1,
        currency: d.currency,
        sessions: d.sessions ?? null,
        conversionRate: d.conversionRate != null ? Number(d.conversionRate) : null,
      }
    }),
    summary,
    error: null,
  })
}
