import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'
import { getDaysInMonth, differenceInDays } from 'date-fns'
import {
  getOrderInclusionWhereFromWorkspace,
  getFilteredDailyAggregates,
  hasNoOrderFilters,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import { computeLineItemsCogs, normalizeCogsSettings } from '@/lib/cogs'
import { getDailyVariableContribution } from '@/lib/workspace-costs'
import { getLogisticsSummary } from '@/lib/workspace-metrics/logistics-summary'

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

export type CustomerFilter = 'all' | 'new' | 'returning'

export type WaterfallStepType = 'revenue' | 'cost' | 'subtotal'

export type WaterfallStep = {
  id: string
  label: string
  /** Absolute value (positive for revenue, negative for costs). Subtotals are the running total. */
  value: number
  type: WaterfallStepType
  /** Human-readable formula for tooltip. */
  formula: string
}

export type WaterfallResponse = {
  steps: WaterfallStep[]
  table: WaterfallStep[]
  currency: string
  /** Shiprocket breakdown (same source as Logistics). Used for formula tooltips. */
  shiprocketBreakdown?: {
    forwardCharges: number
    codCharges: number
    rtoCharges: number
  }
}

/** Get UTC date strings (yyyy-MM-dd) for every day in [from, to]. */
function getDateStringsInRange(fromDate: Date, toDate: Date): string[] {
  const out: string[] = []
  const cur = new Date(fromDate.getTime())
  cur.setUTCHours(0, 0, 0, 0)
  const end = new Date(toDate.getTime())
  end.setUTCHours(23, 59, 59, 999)
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
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
  const customerFilterParam = (searchParams.get('customerFilter') || 'all') as CustomerFilter
  const customerFilter = ['all', 'new', 'returning'].includes(customerFilterParam)
    ? customerFilterParam
    : 'all'

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
    return NextResponse.json({
      steps: [],
      table: [],
      currency: 'INR',
    })
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
    return NextResponse.json(
      { error: 'Invalid date range', steps: [], table: [], currency: 'INR' },
      { status: 400 }
    )
  }

  const storeCurrency = 'INR'
  const orderInclusionWhere = getOrderInclusionWhereFromWorkspace(workspace as any)
  const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)

  const dateStrings = getDateStringsInRange(fromDate, toDate)

  const [
    dailyAnalytics,
    workspaceCosts,
    miscExpenses,
    products,
    lineItemsInRange,
    metaAdDaily,
    googleAdDaily,
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

  const orderDerivedByDate = new Map<
    string,
    { grossSales: number; totalDiscount: number; totalTax: number; ordersCount: number; total_returns: number; returns: number }
  >()
  for (const o of allOrdersInRange) {
    const dateStr = o.processedAt.toISOString().slice(0, 10)
    const cur = orderDerivedByDate.get(dateStr) ?? {
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
    orderDerivedByDate.set(dateStr, cur)
  }

  const analyticsDateSet = new Set(dailyAnalytics.map((d) => d.date.toISOString().slice(0, 10)))
  const orderOnlyDates = [...orderDerivedByDate.keys()].filter((dateStr) => !analyticsDateSet.has(dateStr))
  const orderDerivedRows = orderOnlyDates.map((dateStr) => {
    const v = orderDerivedByDate.get(dateStr)!
    return {
      date: new Date(`${dateStr}T00:00:00.000Z`),
      netSales: new Decimal(v.grossSales - Math.abs(v.totalDiscount)),
      grossSales: new Decimal(v.grossSales),
      totalTax: new Decimal(v.totalTax),
      totalDiscount: new Decimal(v.totalDiscount),
      ordersCount: v.ordersCount,
      currency: storeCurrency,
      total_returns: new Decimal(0),
      returns: new Decimal(0),
    }
  })
  const effectiveDaily = [...dailyAnalytics, ...orderDerivedRows].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  )

  const coqMap = new Map(products.filter((p) => p.coq).map((p) => [p.shopifyId, Number(p.coq)]))
  const cogsSettings = normalizeCogsSettings(workspace.cogsSettings)
  const lineItemsWithDate = lineItemsInRange.map((li) => ({
    price: Number(li.price),
    quantity: li.quantity,
    productShopifyId: li.productShopifyId,
    orderProcessedAt: li.order.processedAt,
  }))
  const { dailyCogs } = computeLineItemsCogs(lineItemsWithDate, coqMap, cogsSettings, {})

  const dailyTotalReturns = new Map<string, number>()
  const dailyReturns = new Map<string, number>()
  for (const d of effectiveDaily) {
    const dateStr = d.date.toISOString().slice(0, 10)
    dailyTotalReturns.set(dateStr, Number(d.total_returns ?? 0))
    dailyReturns.set(dateStr, Number(d.returns ?? 0))
  }

  const dailyAdSpend = new Map<string, number>()
  for (const r of metaAdDaily) {
    const d = r.date.toISOString().slice(0, 10)
    dailyAdSpend.set(d, (dailyAdSpend.get(d) ?? 0) + Number(r.spend))
  }
  for (const r of googleAdDaily) {
    const d = r.date.toISOString().slice(0, 10)
    dailyAdSpend.set(d, (dailyAdSpend.get(d) ?? 0) + Number(r.spend))
  }

  const firstAtMap = new Map<string, Date>()
  for (const order of allOrdersInRange) {
    const cid = order.customerShopifyId
    if (!cid || cid === '') continue
    const existing = firstAtMap.get(cid)
    if (!existing || order.processedAt < existing) {
      firstAtMap.set(cid, order.processedAt)
    }
  }

  const founderMonthly =
    workspace.founder_salary_monthly != null ? Number(workspace.founder_salary_monthly) : 0
  const founderCurrency = workspace.founder_salary_currency ?? 'INR'
  const founderMonthlyConverted = convertCurrency(founderMonthly, founderCurrency, storeCurrency)
  let founderAllocated = 0
  const cur = new Date(fromDate.getTime())
  cur.setUTCHours(0, 0, 0, 0)
  const end = new Date(toDate.getTime())
  end.setUTCHours(23, 59, 59, 999)
  while (cur <= end) {
    const daysInMonth = getDaysInMonth(cur)
    const monthStart = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1, 0, 0, 0, 0))
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0, 23, 59, 59, 999))
    const overlapStart = fromDate > monthStart ? fromDate : monthStart
    const overlapEnd = toDate < monthEnd ? toDate : monthEnd
    const overlapDays = overlapStart <= overlapEnd ? differenceInDays(overlapEnd, overlapStart) + 1 : 0
    founderAllocated += (founderMonthlyConverted / daysInMonth) * overlapDays
    cur.setUTCMonth(cur.getUTCMonth() + 1)
    cur.setUTCDate(1)
  }

  let grossSales = 0
  let totalDiscount = 0
  let totalTax = 0
  let ordersCount = 0
  let cogs = 0
  let adSpend = 0
  /** Variable costs from Costs & Charges: SHIPPING, PACKAGING, WEBSITE (incl. Website Charges %), CUSTOM. Same getDailyVariableContribution as P&L. */
  let variableCosts = 0
  /** Fixed cost = Misc Cost from Costs page. Allocated by day. */
  let fixedCosts = 0

  for (const dateStr of dateStrings) {
    const filtered = filteredDaily.get(dateStr)
    const daily = effectiveDaily.find((d) => d.date.toISOString().slice(0, 10) === dateStr)
    const dayOrders = filtered ? filtered.ordersCount : daily?.ordersCount ?? 0
    const dayGross = filtered ? filtered.grossSales : daily ? Number(daily.grossSales) : 0

    if (filtered) {
      grossSales += filtered.grossSales
      ordersCount += filtered.ordersCount
    } else if (daily) {
      grossSales += Number(daily.grossSales)
      ordersCount += daily.ordersCount
    }
    if (daily) {
      totalDiscount += Number(daily.totalDiscount)
      totalTax += Number(daily.totalTax)
    }
    cogs += dailyCogs.get(dateStr) ?? 0
    adSpend += dailyAdSpend.get(dateStr) ?? 0

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

  let totalReturns = 0
  let returnsProduct = 0
  for (const dateStr of dateStrings) {
    totalReturns += dailyTotalReturns.get(dateStr) ?? 0
    returnsProduct += dailyReturns.get(dateStr) ?? 0
  }
  const refunds = totalReturns
  const discountsAmount = Math.abs(totalDiscount)
  const taxesAmount = Math.abs(totalTax)

  // Shiprocket: single source of truth from getLogisticsSummary (same as Logistics page)
  let forwardCharges = 0
  let codCharges = 0
  let rtoCharges = 0
  if (workspace.shiprocketConnection?.id && workspace.shiprocketConnection?.status === 'CONNECTED') {
    const logistics = await getLogisticsSummary(
      prisma,
      workspace.shiprocketConnection.id,
      fromDate,
      toDate
    )
    forwardCharges = logistics.forwardCharges
    codCharges = logistics.codCharges
    rtoCharges = logistics.rtoCharges
  }
  const shippingOutbound = forwardCharges + codCharges

  let segmentGross = grossSales
  let segmentCogs = cogs
  let ratio = 1
  if (customerFilter !== 'all' && allOrdersInRange.length > 0) {
    segmentGross = 0
    for (const order of allOrdersInRange) {
      const firstAt = order.customerShopifyId ? firstAtMap.get(order.customerShopifyId) : null
      const isFirst = firstAt != null && order.processedAt.getTime() === firstAt.getTime()
      if (customerFilter === 'new' && isFirst) {
        segmentGross += Number(order.totalPrice)
      } else if (customerFilter === 'returning' && !isFirst) {
        segmentGross += Number(order.totalPrice)
      }
    }
    ratio = grossSales > 0 ? segmentGross / grossSales : 0
    segmentCogs = cogs * ratio
  }

  const applyRatio = (v: number) => (customerFilter === 'all' ? v : v * ratio)
  const gs = customerFilter === 'all' ? grossSales : segmentGross
  const disc = applyRatio(totalDiscount)
  const ref = applyRatio(refunds)
  const tax = applyRatio(totalTax)
  const ship = applyRatio(shippingOutbound)
  const rto = applyRatio(rtoCharges)
  const varCosts = applyRatio(variableCosts)
  const ad = applyRatio(adSpend)
  const fixed = applyRatio(fixedCosts)
  const founder = applyRatio(founderAllocated)
  const cogsVal = customerFilter === 'all' ? cogs : segmentCogs

  // App definitions: Revenue After Tax & Shipping = Gross - Discounts - Refunds - Tax - Shipping
  const revenueAfterTaxShipping = gs - Math.abs(disc) - Math.abs(ref) - Math.abs(tax) - ship
  // CM1 = Revenue After Tax & Shipping - COGS - Variable Costs - RTO Cost
  const cm1 = revenueAfterTaxShipping - cogsVal - varCosts - rto
  // CM2 = CM1 - Ad Spend
  const cm2 = cm1 - ad
  // CM3 = CM2 - Fixed Cost (Misc Cost)
  const cm3 = cm2 - fixed
  // Net Profit = CM3 - Founder's salary
  const netProfit = cm3 - founder

  const steps: WaterfallStep[] = [
    {
      id: 'grossSales',
      label: 'Gross Sales',
      value: gs,
      type: 'revenue',
      formula: 'Gross Sales = Sum of order totalPrice (Shopify, filtered by workspace) for the selected date range.',
    },
    {
      id: 'discounts',
      label: 'Discounts',
      value: -Math.abs(disc),
      type: 'cost',
      formula: 'Discounts = Total discounts from Shopify analytics daily (totalDiscount). Prorated when customer filter is New/Returning.',
    },
    {
      id: 'refunds',
      label: 'Refunds',
      value: -Math.abs(ref),
      type: 'cost',
      formula: 'Refunds = Total returns from Shopify analytics daily (total_returns). Prorated when customer filter is New/Returning.',
    },
    {
      id: 'tax',
      label: 'Tax',
      value: -Math.abs(tax),
      type: 'cost',
      formula: 'Tax = Total tax from Shopify analytics daily (totalTax). Prorated when customer filter is New/Returning.',
    },
    {
      id: 'shipping',
      label: 'Shipping',
      value: -ship,
      type: 'cost',
      formula: 'Shipping = Forward charges + COD charges from Shiprocket (same source as Logistics). Sum over shipments in date range by shipment date.',
    },
    {
      id: 'revenueAfterTaxShipping',
      label: 'Revenue After Tax & Shipping',
      value: revenueAfterTaxShipping,
      type: 'subtotal',
      formula: 'Revenue After Tax & Shipping = Gross Sales - Discounts - Refunds - Tax - Shipping',
    },
    {
      id: 'cogs',
      label: 'COGS',
      value: -cogsVal,
      type: 'cost',
      formula: 'COGS = Cost of goods sold from line items (product COGS). Uses workspace COGS settings and product COQ. Prorated when customer filter is New/Returning.',
    },
    {
      id: 'variableCosts',
      label: 'Variable Costs',
      value: -varCosts,
      type: 'cost',
      formula: 'Variable Costs = All variable costs from Costs & Charges: Shipping, Packaging, Website Charges (%), and Custom. Uses getDailyVariableContribution (same as P&L). Website Charges (%) = configured % of gross sales. Prorated when customer filter is New/Returning.',
    },
    {
      id: 'rtoCost',
      label: 'RTO Cost',
      value: -rto,
      type: 'cost',
      formula: 'RTO Cost = Sum of Shiprocket RTO charges for shipments in date range. Same source as Logistics. Prorated when customer filter is New/Returning.',
    },
    {
      id: 'cm1',
      label: 'CM1',
      value: cm1,
      type: 'subtotal',
      formula: 'CM1 = Revenue After Tax & Shipping - COGS - Variable Costs - RTO Cost',
    },
    {
      id: 'adSpend',
      label: 'Ad Spend',
      value: -ad,
      type: 'cost',
      formula: 'Ad Spend = Meta Ads + Google Ads spend in date range. Prorated when customer filter is New/Returning.',
    },
    {
      id: 'cm2',
      label: 'CM2',
      value: cm2,
      type: 'subtotal',
      formula: 'CM2 = CM1 - Ad Spend',
    },
    {
      id: 'fixedCost',
      label: 'Fixed Cost',
      value: -fixed,
      type: 'cost',
      formula: 'Fixed Cost = Misc Cost configured in Costs page. Allocated by day over the period. Prorated when customer filter is New/Returning.',
    },
    {
      id: 'cm3',
      label: 'CM3',
      value: cm3,
      type: 'subtotal',
      formula: 'CM3 = CM2 - Fixed Cost',
    },
    {
      id: 'founderSalary',
      label: "Founder's Salary",
      value: -founder,
      type: 'cost',
      formula: "Founder's Salary = Founder's monthly salary (workspace setting), allocated by days in range. Prorated when customer filter is New/Returning.",
    },
    {
      id: 'netProfit',
      label: 'Net Profit',
      value: netProfit,
      type: 'subtotal',
      formula: "Net Profit = CM3 - Founder's Salary",
    },
  ]

  return NextResponse.json({
    steps,
    table: steps,
    currency: storeCurrency,
    shiprocketBreakdown:
      workspace.shiprocketConnection?.id && workspace.shiprocketConnection?.status === 'CONNECTED'
        ? { forwardCharges, codCharges, rtoCharges }
        : undefined,
  })
}
