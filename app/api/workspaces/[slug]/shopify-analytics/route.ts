import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { eachDayOfInterval, getDaysInMonth } from 'date-fns'
import { getOrderInclusionWhereFromWorkspace } from '@/lib/order-filters'
import { getRtoSummary } from '@/lib/workspace-metrics'
import { computeLineItemsCogs, normalizeCogsSettings } from '@/lib/cogs'
import { getDailyVariableContribution } from '@/lib/workspace-costs'
import { fetchGoalRowsMap, buildGoalEvaluations } from '@/lib/metrics/goals'
import type { GoalMetricId } from '@/lib/metrics/goal-metrics-registry'

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
      cogsSettings: true,
      meta_ads_connections: {
        select: {
          id: true,
          currency: true,
          selected_ad_account_ids: true,
          selected_ad_account_id: true,
        },
      },
      google_ads_connections: {
        select: {
          id: true,
          currency: true,
          selected_customer_ids: true,
          selected_customer_id: true,
        },
      },
      shiprocketConnection: {
        select: { id: true, status: true },
      },
      woocommerceConnection: {
        where: { status: 'CONNECTED' },
        select: { id: true, currency: true },
      },
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

  const isWoocommerce = workspace.platform === 'WOOCOMMERCE'
  const connectionId = workspace.shopifyConnections[0]?.id
  const wooConnectionId = workspace.woocommerceConnection?.id
  if (!connectionId && !wooConnectionId) {
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

  if (isWoocommerce && wooConnectionId) {
    const [orders, products, workspaceCosts, miscExpenses] = await Promise.all([
      prisma.woocommerceOrder.findMany({
        where: {
          connectionId: wooConnectionId,
          status: { notIn: ['cancelled', 'failed', 'pending'] },
          dateCreated: { gte: fromDate, lte: toDate },
        },
        select: {
          id: true,
          dateCreated: true,
          total: true,
          subtotal: true,
          discountTotal: true,
          totalTax: true,
          currency: true,
          lineItems: { select: { sku: true, quantity: true } },
        },
        orderBy: { dateCreated: 'asc' },
      }),
      prisma.woocommerceProduct.findMany({
        where: {
          connectionId: wooConnectionId,
          sku: { not: null },
          coq: { not: null },
          status: { not: 'trash' },
        },
        select: { sku: true, coq: true },
      }),
      prisma.workspaceCost.findMany({
        where: {
          workspaceId: workspace.id,
          effectiveFrom: { lte: toDate },
        },
      }),
      prisma.workspaceMiscExpense.findMany({
        where: {
          workspaceId: workspace.id,
          effectiveStartDate: { lte: toDate },
        },
      }),
    ])

    const storeCurrency =
      workspace.woocommerceConnection?.currency ||
      orders.find((o) => o.currency)?.currency ||
      'USD'
    const coqMap = new Map(
      products.map((p) => [String(p.sku).trim().toLowerCase(), Number(p.coq ?? 0)])
    )

    const dayMap = new Map<
      string,
      {
        netSales: number
        grossSales: number
        totalTax: number
        totalDiscount: number
        ordersCount: number
        cogs: number
      }
    >()

    for (const o of orders) {
      if (!o.dateCreated) continue
      const dateStr = o.dateCreated.toISOString().slice(0, 10)
      const gross = Number(o.subtotal ?? o.total ?? 0)
      const discount = Number(o.discountTotal ?? 0)
      const tax = Number(o.totalTax ?? 0)
      const net = Number(o.total ?? 0) - tax
      let cogs = 0
      for (const li of o.lineItems) {
        const sku = li.sku?.trim().toLowerCase()
        if (!sku) continue
        cogs += (coqMap.get(sku) ?? 0) * (li.quantity ?? 0)
      }
      const cur = dayMap.get(dateStr) ?? {
        netSales: 0,
        grossSales: 0,
        totalTax: 0,
        totalDiscount: 0,
        ordersCount: 0,
        cogs: 0,
      }
      cur.netSales += net
      cur.grossSales += gross
      cur.totalTax += tax
      cur.totalDiscount += Math.abs(discount)
      cur.ordersCount += 1
      cur.cogs += cogs
      dayMap.set(dateStr, cur)
    }

    const dailyKeys = [...dayMap.keys()].sort()
    const daily = dailyKeys.map((dateStr) => {
      const d = dayMap.get(dateStr)!
      const dayGrossSales = d.grossSales
      let shipping = 0
      let packaging = 0
      let websiteCharges = 0
      for (const cost of workspaceCosts) {
        const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
        const costToStr = cost.effectiveTo
          ? cost.effectiveTo.toISOString().slice(0, 10)
          : '9999-12-31'
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
          d.ordersCount,
          dayGrossSales,
          storeCurrency
        )
        if (cost.costType === 'SHIPPING') shipping += contribution
        else if (cost.costType === 'PACKAGING') packaging += contribution
        else if (cost.costType === 'WEBSITE') websiteCharges += contribution
      }
      const cm1 = d.netSales - d.cogs - shipping - packaging - websiteCharges
      return {
        date: dateStr,
        netSales: d.netSales,
        grossSales: d.grossSales,
        totalTax: d.totalTax,
        totalDiscount: d.totalDiscount,
        ordersCount: d.ordersCount,
        aov: d.ordersCount > 0 ? d.netSales / d.ordersCount : 0,
        cogs: d.cogs,
        shipping,
        packaging,
        websiteCharges,
        cm1,
        currency: storeCurrency,
        sessions: null,
        conversionRate: null,
      }
    })

    const totalNetSales = daily.reduce((s, d) => s + d.netSales, 0)
    const totalGrossSales = daily.reduce((s, d) => s + d.grossSales, 0)
    const totalTax = daily.reduce((s, d) => s + d.totalTax, 0)
    const totalDiscount = daily.reduce((s, d) => s + d.totalDiscount, 0)
    const totalOrders = daily.reduce((s, d) => s + d.ordersCount, 0)
    const totalCogs = daily.reduce((s, d) => s + d.cogs, 0)
    const totalShipping = daily.reduce((s, d) => s + d.shipping, 0)
    const totalPackaging = daily.reduce((s, d) => s + d.packaging, 0)
    const totalWebsiteCharges = daily.reduce((s, d) => s + d.websiteCharges, 0)
    const totalCm1 =
      totalNetSales -
      totalCogs -
      totalShipping -
      totalPackaging -
      totalWebsiteCharges

    const metaConn = workspace.meta_ads_connections
    const googleConn = workspace.google_ads_connections
    const metaSelectedIds = metaConn?.selected_ad_account_ids?.length
      ? metaConn.selected_ad_account_ids
      : metaConn?.selected_ad_account_id
        ? [metaConn.selected_ad_account_id]
        : undefined
    const googleSelectedIds = googleConn?.selected_customer_ids?.length
      ? googleConn.selected_customer_ids
      : googleConn?.selected_customer_id
        ? [googleConn.selected_customer_id]
        : undefined

    let metaAdSpend = 0
    let googleAdSpend = 0
    if (metaConn?.id) {
      const metaAgg = await prisma.meta_ads_daily_metrics.aggregate({
        where: {
          connection_id: metaConn.id,
          date: { gte: fromDate, lte: toDate },
          ...(metaSelectedIds ? { ad_account_id: { in: metaSelectedIds } } : {}),
        },
        _sum: { spend: true },
      })
      metaAdSpend = Number(metaAgg._sum.spend ?? 0)
    }
    if (googleConn?.id) {
      const googleAgg = await prisma.google_ads_daily_metrics.aggregate({
        where: {
          connection_id: googleConn.id,
          date: { gte: fromDate, lte: toDate },
          ...(googleSelectedIds
            ? { customer_id: { in: googleSelectedIds } }
            : {}),
        },
        _sum: { spend: true },
      })
      googleAdSpend = Number(googleAgg._sum.spend ?? 0)
    }
    const totalAdSpend = metaAdSpend + googleAdSpend
    const metaAdCurrency = workspace.meta_ads_connections?.currency ?? storeCurrency
    const googleAdCurrency = workspace.google_ads_connections?.currency ?? storeCurrency
    const totalAdCurrency =
      metaAdCurrency === googleAdCurrency ? metaAdCurrency : storeCurrency
    const totalCm2 = totalCm1 - totalAdSpend
    const miscExpensesTotal = miscExpenses.reduce(
      (sum, e) => sum + Number(e.amount ?? 0),
      0
    )
    const totalCm3 = totalCm2 - miscExpensesTotal
    const cm3Pct =
      totalNetSales > 0
        ? Math.round((totalCm3 / totalNetSales) * 10000) / 100
        : null

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
      cm2: totalCm2,
      miscExpensesTotal,
      cm3: totalCm3,
      cm3Pct,
      currency: storeCurrency,
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      prepaidPercentage: null,
      totalSessions: null,
      conversionRate: null,
      metaAdSpend,
      metaAdCurrency,
      googleAdSpend,
      googleAdCurrency,
      totalAdSpend,
      totalAdCurrency,
      mer:
        totalAdSpend > 0
          ? Math.round((totalNetSales / totalAdSpend) * 100) / 100
          : null,
      acos:
        totalNetSales > 0
          ? Math.round((totalAdSpend / totalNetSales) * 10000) / 100
          : null,
      rtoOrders: 0,
      rtoPercent: null,
      rtoValue: 0,
      rtoMapped: 0,
      rtoUnmapped: 0,
      totalShipmentsInRange: 0,
    }

    const goalRowMap = await fetchGoalRowsMap(
      prisma,
      workspace.id,
      ['revenue', 'cm3', 'cm3_pct', 'mer', 'aov', 'acos'] as GoalMetricId[],
      toDate
    )
    const goalEvaluations = buildGoalEvaluations(
      {
        revenue: totalNetSales,
        cm3: totalCm3,
        cm3_pct: cm3Pct ?? undefined,
        mer: summary.mer ?? undefined,
        aov: summary.avgAov,
        acos: summary.acos ?? undefined,
      },
      goalRowMap
    )

    return NextResponse.json({
      daily,
      summary: { ...summary, goalEvaluations },
      error: null,
    })
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

  

  // COGS via shared resolver (override/fallback/markup from workspace settings)
  const products = await prisma.shopifyProduct.findMany({
    where: { connectionId },
    select: { shopifyId: true, coq: true },
  })
  const coqMap = new Map<string, number>()
  for (const p of products) {
    if (p.coq) coqMap.set(p.shopifyId, Number(p.coq))
  }

  const lineItems = await prisma.shopifyLineItem.findMany({
    where: {
      connectionId,
      order: { processedAt: { gte: fromDate, lte: toDate } },
    },
    select: {
      productShopifyId: true,
      quantity: true,
      price: true,
      order: { select: { processedAt: true } },
    },
  })

  const cogsSettings = normalizeCogsSettings(workspace.cogsSettings)
  const lineItemsWithDate = lineItems.map((item) => ({
    price: Number(item.price),
    quantity: Number(item.quantity),
    productShopifyId: item.productShopifyId,
    orderProcessedAt: item.order.processedAt,
  }))
  const { totalCogs, dailyCogs } = computeLineItemsCogs(lineItemsWithDate, coqMap, cogsSettings, {
    logSampleSource: process.env.NODE_ENV === 'development' ? 'analytics' : undefined,
  })

  if (process.env.NODE_ENV === 'development' && lineItems.length > 0) {
    console.log('[shopify-analytics] COGS', {
      from: fromStr,
      to: toStr,
      cogsSettings: {
        overrideAllCogsPercent: cogsSettings.overrideAllCogsPercent,
        fallbackCogsPercent: cogsSettings.fallbackCogsPercent,
        cogsMarkupPercent: cogsSettings.cogsMarkupPercent,
      },
      lineItemCount: lineItems.length,
      totalCogs: Math.round(totalCogs * 100) / 100,
    })
  }

  // Calculate other costs based on WorkspaceCost
  const workspaceCosts = await prisma.workspaceCost.findMany({
    where: {
      workspaceId: workspace.id,
      effectiveFrom: { lte: toDate },
    },
  })

  // Misc expenses for CM3: include if effectiveStartDate <= rangeEnd
  const miscExpenses = await prisma.workspaceMiscExpense.findMany({
    where: {
      workspaceId: workspace.id,
      effectiveStartDate: { lte: toDate },
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

  // Ad spend for the date range (Meta + Google) — scoped to selected accounts
  let metaAdSpend = 0
  let googleAdSpend = 0
  const metaConn = workspace.meta_ads_connections
  const googleConn = workspace.google_ads_connections
  const metaConnectionId = metaConn?.id
  const googleConnectionId = googleConn?.id

  const metaSelectedIds = metaConn?.selected_ad_account_ids?.length
    ? metaConn.selected_ad_account_ids
    : metaConn?.selected_ad_account_id
      ? [metaConn.selected_ad_account_id]
      : undefined

  const googleSelectedIds = googleConn?.selected_customer_ids?.length
    ? googleConn.selected_customer_ids
    : googleConn?.selected_customer_id
      ? [googleConn.selected_customer_id]
      : undefined

  if (metaConnectionId) {
    const metaWhere: Record<string, unknown> = {
      connection_id: metaConnectionId,
      date: { gte: fromDate, lte: toDate },
    }
    if (metaSelectedIds) metaWhere.ad_account_id = { in: metaSelectedIds }

    const metaAgg = await prisma.meta_ads_daily_metrics.aggregate({
      where: metaWhere as Parameters<typeof prisma.meta_ads_daily_metrics.aggregate>[0]['where'],
      _sum: { spend: true },
    })
    metaAdSpend = Number(metaAgg._sum.spend ?? 0)
  }

  const metaAdRows = metaConnectionId
    ? await prisma.meta_ads_daily_metrics.findMany({
        where: {
          connection_id: metaConnectionId,
          date: { gte: fromDate, lte: toDate },
          ...(metaSelectedIds ? { ad_account_id: { in: metaSelectedIds } } : {}),
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
    selectedAccounts: metaSelectedIds ?? 'all',
    totalSpend: metaAdSpend,
    rowCount: metaAdRows.length,
  })

  if (googleConnectionId) {
    const googleWhere: Record<string, unknown> = {
      connection_id: googleConnectionId,
      date: { gte: fromDate, lte: toDate },
    }
    if (googleSelectedIds) googleWhere.customer_id = { in: googleSelectedIds }

    const googleAgg = await prisma.google_ads_daily_metrics.aggregate({
      where: googleWhere as Parameters<typeof prisma.google_ads_daily_metrics.aggregate>[0]['where'],
      _sum: { spend: true },
    })
    googleAdSpend = Number(googleAgg._sum.spend ?? 0)
  }

  const googleAdRows = googleConnectionId
    ? await prisma.google_ads_daily_metrics.findMany({
        where: {
          connection_id: googleConnectionId,
          date: { gte: fromDate, lte: toDate },
          ...(googleSelectedIds ? { customer_id: { in: googleSelectedIds } } : {}),
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
    selectedCustomers: googleSelectedIds ?? 'all',
    totalSpend: googleAdSpend,
    rowCount: googleAdRows.length,
  })

  const totalAdSpend = metaAdSpend + googleAdSpend
  const metaAdCurrency = workspace.meta_ads_connections?.currency ?? storeCurrency
  const googleAdCurrency = workspace.google_ads_connections?.currency ?? storeCurrency
  const totalAdCurrency =
    metaAdCurrency === googleAdCurrency ? metaAdCurrency : storeCurrency

  // ── RTO metrics (from Shiprocket tracking; effective date, workspace order filters) ──
  let rtoOrders = 0
  let rtoPercent: number | null = null
  let rtoValue = 0
  let rtoMapped = 0
  let rtoUnmapped = 0
  let totalShipmentsInRange = 0

  const srConn = workspace.shiprocketConnection
  if (srConn?.status === 'CONNECTED') {
    const orderInclusionWhere = getOrderInclusionWhereFromWorkspace(workspace as any)
    const rto = await getRtoSummary(
      prisma,
      connectionId,
      srConn.id,
      fromDate,
      toDate,
      orderInclusionWhere
    )
    totalShipmentsInRange = rto.totalShipments
    rtoOrders = rto.rtoOrders
    rtoPercent = rto.rtoPercent
    rtoValue = rto.rtoValue
    rtoMapped = rto.rtoMapped
    rtoUnmapped = rto.rtoUnmapped
  }

  let totalShipping = 0
  let totalPackaging = 0
  let totalWebsiteCharges = 0
  const dailyCosts = new Map<string, { shipping: number; packaging: number; website: number }>()

  for (const d of daily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    const ordersCount = d.ordersCount
    const dayGrossSales = Number(d.grossSales)

    let dayShipping = 0
    let dayPackaging = 0
    let dayWebsiteCharge = 0

    for (const cost of workspaceCosts) {
      const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
      const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
      if (dateStr >= costFromStr && dateStr <= costToStr) {
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
          dayGrossSales,
          storeCurrency
        )
        if (cost.costType === 'SHIPPING') dayShipping += contribution
        else if (cost.costType === 'PACKAGING') dayPackaging += contribution
        else if (cost.costType === 'WEBSITE') dayWebsiteCharge += contribution
      }
    }

    totalShipping += dayShipping
    totalPackaging += dayPackaging
    totalWebsiteCharges += dayWebsiteCharge

    dailyCosts.set(dateStr, {
      shipping: dayShipping,
      packaging: dayPackaging,
      website: dayWebsiteCharge,
    })
  }

  // Assuming Product COGS is stored in Store's native currency by default.
  // If COGS needs conversion later, it can be applied around the `coqMap`.

  const totalCm1 = totalNetSales - totalCogs - totalShipping - totalPackaging - totalWebsiteCharges
  const totalCm2 = totalCm1 - totalAdSpend

  const miscExpensesTotal = miscExpenses.reduce((sum, e) => {
    const monthlyAmt = convertCurrency(Number(e.amount), e.currency || 'INR', storeCurrency)
    const expStart = new Date(e.effectiveStartDate)
    const applyFrom = expStart > fromDate ? expStart : fromDate
    if (applyFrom > toDate) return sum

    const overlapStart = new Date(`${applyFrom.toISOString().slice(0, 10)}T00:00:00.000Z`)
    const overlapEnd = new Date(`${toDate.toISOString().slice(0, 10)}T00:00:00.000Z`)

    const days = eachDayOfInterval({ start: overlapStart, end: overlapEnd })
    const contribution = days.reduce((s, d) => s + monthlyAmt / getDaysInMonth(d), 0)
    return sum + contribution
  }, 0)
  const totalCm3 = totalCm2 - miscExpensesTotal
  const cm3Pct =
    totalNetSales > 0
      ? Math.round((totalCm3 / totalNetSales) * 10000) / 100
      : null

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
    cm2: totalCm2,
    miscExpensesTotal,
    cm3: totalCm3,
    cm3Pct,
    currency: storeCurrency,
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    prepaidPercentage,
    totalSessions,
    conversionRate: conversionRatePeriod,
    metaAdSpend: metaAdSpend,
    metaAdCurrency,
    googleAdSpend: googleAdSpend,
    googleAdCurrency,
    totalAdSpend: totalAdSpend,
    totalAdCurrency,
    /** Same ratio as blended ROAS: net sales / ad spend (spec label: MER). */
    mer:
      totalAdSpend > 0
        ? Math.round((totalNetSales / totalAdSpend) * 100) / 100
        : null,
    acos:
      totalNetSales > 0
        ? Math.round((totalAdSpend / totalNetSales) * 10000) / 100
        : null,
    rtoOrders,
    rtoPercent,
    rtoValue,
    rtoMapped,
    rtoUnmapped,
    totalShipmentsInRange,
  }

  const goalRowMap = await fetchGoalRowsMap(
    prisma,
    workspace.id,
    ['revenue', 'cm3', 'cm3_pct', 'mer', 'aov', 'acos'] as GoalMetricId[],
    toDate
  )
  const goalEvaluations = buildGoalEvaluations(
    {
      revenue: totalNetSales,
      cm3: totalCm3,
      cm3_pct: cm3Pct ?? undefined,
      mer: summary.mer ?? undefined,
      aov: summary.avgAov,
      acos: summary.acos ?? undefined,
    },
    goalRowMap
  )

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
    summary: { ...summary, goalEvaluations },
    error: null,
  })
}
