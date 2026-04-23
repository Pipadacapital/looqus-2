import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'
import { startOfYear, endOfDay, format, eachDayOfInterval, subDays } from 'date-fns'
import { computeAcquisition, computeAcquisitionTrend, computeAcquisitionComposition } from '@/lib/acquisition/compute'
import { fetchGoalRowsMap, buildGoalEvaluations } from '@/lib/metrics/goals'
import type { GoalMetricId } from '@/lib/metrics/goal-metrics-registry'
import { computeMarketingEfficiency } from '@/lib/metrics'

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

  const guard = featureGuard((workspace as any).features as any, 'acquisition')
  if (guard) return guard

  const now = new Date()
  const defaultFrom = format(startOfYear(now), 'yyyy-MM-dd')
  const defaultTo = format(endOfDay(now), 'yyyy-MM-dd')
  const fromStr = fromParam ?? defaultFrom
  const toStr = toParam ?? defaultTo

  const fromDate = new Date(fromStr + 'T00:00:00.000Z')
  const toDate = new Date(toStr + 'T23:59:59.999Z')
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  const [result, trend, composition] = await Promise.all([
    workspace.platform === 'WOOCOMMERCE'
      ? computeAcquisitionWoo(prisma, workspace as any, { from: fromStr, to: toStr })
      : computeAcquisition(prisma, workspace as any, { from: fromStr, to: toStr }),
    workspace.platform === 'WOOCOMMERCE'
      ? computeAcquisitionTrendWoo(prisma, workspace as any, { from: fromStr, to: toStr })
      : computeAcquisitionTrend(prisma, workspace as any, { from: fromStr, to: toStr }),
    workspace.platform === 'WOOCOMMERCE'
      ? computeAcquisitionCompositionWoo(prisma, workspace as any, { from: fromStr, to: toStr })
      : computeAcquisitionComposition(prisma, workspace as any, { from: fromStr, to: toStr }),
  ])

  const goalRowMap = await fetchGoalRowsMap(
    prisma,
    workspace.id,
    ['mer', 'amer', 'cac', 'new_customers'] as GoalMetricId[],
    toDate
  )
  const me = result.summary.marketingEfficiency
  const goalEvaluations = buildGoalEvaluations(
    {
      mer: me.mer ?? undefined,
      amer: me.aMer ?? undefined,
      cac: result.summary.blendedCac,
      new_customers: result.summary.newCustomers,
    },
    goalRowMap
  )

  return NextResponse.json({
    summary: { ...result.summary, goalEvaluations },
    daily: result.daily,
    currency: result.currency,
    trend,
    composition,
  })
}

const WOO_EXCLUDED_STATUSES = ['cancelled', 'failed', 'pending']

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

async function getWooAdSpendMaps(
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
) {
  const byDate = new Map<string, number>()
  const metaByDate = new Map<string, number>()
  const googleByDate = new Map<string, number>()
  const acquisitionByDate = new Map<string, number>()

  const meta = workspace.meta_ads_connections
  if (meta?.id) {
    const metaIds = meta.selected_ad_account_ids?.length
      ? meta.selected_ad_account_ids
      : meta.selected_ad_account_id
        ? [meta.selected_ad_account_id]
        : undefined
    const where: {
      connection_id: string
      date: { gte: Date; lte: Date }
      ad_account_id?: { in: string[] }
    } = {
      connection_id: meta.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (metaIds?.length) where.ad_account_id = { in: metaIds }
    const rows = await prisma.meta_ads_daily_metrics.groupBy({
      by: ['date'],
      where,
      _sum: { spend: true },
    })
    for (const row of rows) {
      const d = row.date.toISOString().slice(0, 10)
      const spend = Number(row._sum.spend ?? 0)
      metaByDate.set(d, (metaByDate.get(d) ?? 0) + spend)
      byDate.set(d, (byDate.get(d) ?? 0) + spend)
      acquisitionByDate.set(d, (acquisitionByDate.get(d) ?? 0) + spend)
    }
  }

  const google = workspace.google_ads_connections
  if (google?.id) {
    const googleIds = google.selected_customer_ids?.length
      ? google.selected_customer_ids
      : google.selected_customer_id
        ? [google.selected_customer_id]
        : undefined
    const where: {
      connection_id: string
      date: { gte: Date; lte: Date }
      customer_id?: { in: string[] }
    } = {
      connection_id: google.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (googleIds?.length) where.customer_id = { in: googleIds }
    const rows = await prisma.google_ads_daily_metrics.groupBy({
      by: ['date'],
      where,
      _sum: { spend: true },
    })
    for (const row of rows) {
      const d = row.date.toISOString().slice(0, 10)
      const spend = Number(row._sum.spend ?? 0)
      googleByDate.set(d, (googleByDate.get(d) ?? 0) + spend)
      byDate.set(d, (byDate.get(d) ?? 0) + spend)
      acquisitionByDate.set(d, (acquisitionByDate.get(d) ?? 0) + spend)
    }
  }

  return { byDate, metaByDate, googleByDate, acquisitionByDate }
}

async function computeAcquisitionWoo(
  prismaClient: typeof prisma,
  workspace: any,
  params: { from: string; to: string }
) {
  const wooConn = await prismaClient.woocommerceConnection.findUnique({
    where: { workspaceId: workspace.id },
    select: { id: true, currency: true },
  })
  if (!wooConn) {
    return {
      summary: {
        cm2: 0,
        newCustomers: 0,
        cm2PerNc: 0,
        meta: 0,
        google: 0,
        totalAdSpend: 0,
        blendedCac: 0,
        marketingEfficiency: computeMarketingEfficiency({
          storeNetRevenue: 0,
          totalAdSpend: 0,
          newCustomerRevenue: 0,
          acquisitionAdSpend: 0,
        }),
      },
      daily: [],
      currency: 'USD',
    }
  }

  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const fromExtended = subDays(fromDate, 364)

  const [allOrdersUntilTo, cogsProducts, adSpendMaps] = await Promise.all([
    prismaClient.woocommerceOrder.findMany({
      where: {
        connectionId: wooConn.id,
        status: { notIn: [...WOO_EXCLUDED_STATUSES] },
        customerEmail: { not: null },
        dateCreated: { lte: toDate },
      },
      select: {
        id: true,
        customerEmail: true,
        dateCreated: true,
        total: true,
        totalTax: true,
        lineItems: { select: { sku: true, quantity: true } },
      },
      orderBy: { dateCreated: 'asc' },
    }),
    prismaClient.woocommerceProduct.findMany({
      where: {
        connectionId: wooConn.id,
        sku: { not: null },
        coq: { not: null },
        status: { not: 'trash' },
      },
      select: { sku: true, coq: true },
    }),
    getWooAdSpendMaps(workspace, fromExtended, toDate),
  ])

  const cogsBySku = new Map(
    cogsProducts.map((p) => [String(p.sku).trim().toLowerCase(), Number(p.coq ?? 0)])
  )

  const firstOrderByCustomer = new Map<string, (typeof allOrdersUntilTo)[number]>()
  for (const order of allOrdersUntilTo) {
    if (!order.customerEmail || !order.dateCreated) continue
    const email = order.customerEmail.trim().toLowerCase()
    if (!email || firstOrderByCustomer.has(email)) continue
    firstOrderByCustomer.set(email, order)
  }

  const firstOrdersInRange = Array.from(firstOrderByCustomer.values()).filter((o) => {
    if (!o.dateCreated) return false
    return o.dateCreated >= fromDate && o.dateCreated <= toDate
  })

  const byDay = new Map<
    string,
    {
      ncCm2: number
      newCustomers: number
      adSpend: number
      meta: number
      google: number
      ncRevenue: number
    }
  >()

  let totalNcCm2 = 0
  let newCustomerRevenue = 0
  for (const order of firstOrdersInRange) {
    if (!order.dateCreated) continue
    const dateStr = order.dateCreated.toISOString().slice(0, 10)
    const total = Number(order.total ?? 0)
    const totalTax = Number(order.totalTax ?? 0)
    let cogs = 0
    for (const li of order.lineItems) {
      const sku = li.sku?.trim().toLowerCase()
      if (!sku) continue
      cogs += (cogsBySku.get(sku) ?? 0) * (li.quantity ?? 0)
    }

    const dayFirstOrdersCount = firstOrdersInRange.filter(
      (o) => o.dateCreated?.toISOString().slice(0, 10) === dateStr
    ).length || 1
    const perOrderAdSpend = (adSpendMaps.byDate.get(dateStr) ?? 0) / dayFirstOrdersCount
    const cm2 = total - cogs - perOrderAdSpend
    const netRevenue = total - totalTax

    totalNcCm2 += cm2
    newCustomerRevenue += netRevenue

    const cur = byDay.get(dateStr) ?? {
      ncCm2: 0,
      newCustomers: 0,
      adSpend: adSpendMaps.byDate.get(dateStr) ?? 0,
      meta: adSpendMaps.metaByDate.get(dateStr) ?? 0,
      google: adSpendMaps.googleByDate.get(dateStr) ?? 0,
      ncRevenue: 0,
    }
    cur.ncCm2 += cm2
    cur.newCustomers += 1
    cur.ncRevenue += netRevenue
    byDay.set(dateStr, cur)
  }

  const totalMeta = [...adSpendMaps.metaByDate.values()].reduce((a, b) => a + b, 0)
  const totalGoogle = [...adSpendMaps.googleByDate.values()].reduce((a, b) => a + b, 0)
  const totalAdSpend = totalMeta + totalGoogle
  const newCustomers = firstOrdersInRange.length
  const cm2PerNc = newCustomers > 0 ? totalNcCm2 / newCustomers : 0
  const blendedCac = newCustomers > 0 ? totalAdSpend / newCustomers : 0

  const allDays = new Set<string>()
  for (const d of adSpendMaps.byDate.keys()) allDays.add(d)
  for (const d of byDay.keys()) allDays.add(d)

  const daily = [...allDays]
    .filter((d) => d >= params.from && d <= params.to)
    .sort()
    .map((dateStr) => {
      const day = byDay.get(dateStr)
      const adSpend = adSpendMaps.byDate.get(dateStr) ?? 0
      const acq = adSpendMaps.acquisitionByDate.get(dateStr) ?? 0
      const nc = day?.newCustomers ?? 0
      const ncCm2 = day?.ncCm2 ?? 0
      const ncRev = day?.ncRevenue ?? 0
      return {
        date: dateStr,
        ncCm2,
        adSpend,
        cm2PerNc: nc > 0 ? ncCm2 / nc : 0,
        blendedCac: nc > 0 ? adSpend / nc : 0,
        newCustomers: nc,
        meta: adSpendMaps.metaByDate.get(dateStr) ?? 0,
        google: adSpendMaps.googleByDate.get(dateStr) ?? 0,
        acquisitionAdSpend: acq,
        aMerDaily: acq > 0 ? ncRev / acq : null,
        ncRevenue: ncRev,
      }
    })

  const storeNetRevenue = allOrdersUntilTo
    .filter((o) => o.dateCreated && o.dateCreated >= fromDate && o.dateCreated <= toDate)
    .reduce((s, o) => s + Number(o.total ?? 0) - Number(o.totalTax ?? 0), 0)

  const summary = {
    cm2: totalNcCm2,
    newCustomers,
    cm2PerNc,
    meta: totalMeta,
    google: totalGoogle,
    totalAdSpend,
    blendedCac,
    marketingEfficiency: computeMarketingEfficiency({
      storeNetRevenue,
      totalAdSpend,
      newCustomerRevenue,
      acquisitionAdSpend: [...adSpendMaps.acquisitionByDate.entries()]
        .filter(([d]) => d >= params.from && d <= params.to)
        .reduce((s, [, v]) => s + v, 0),
    }),
  }

  const anyOrderCurrency = await prismaClient.woocommerceOrder.findFirst({
    where: { connectionId: wooConn.id, currency: { not: null } },
    select: { currency: true },
    orderBy: { dateCreated: 'desc' },
  })
  const currency = wooConn.currency?.trim() || anyOrderCurrency?.currency?.trim() || 'USD'

  return { summary, daily, currency }
}

async function computeAcquisitionTrendWoo(
  prismaClient: typeof prisma,
  workspace: any,
  params: { from: string; to: string }
) {
  const wooConn = await prismaClient.woocommerceConnection.findUnique({
    where: { workspaceId: workspace.id },
    select: { id: true },
  })
  if (!wooConn) return []

  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const fromExtended = subDays(fromDate, 364)

  const orders = await prismaClient.woocommerceOrder.findMany({
    where: {
      connectionId: wooConn.id,
      status: { notIn: [...WOO_EXCLUDED_STATUSES] },
      customerEmail: { not: null },
      dateCreated: { gte: fromExtended, lte: toDate },
    },
    select: { customerEmail: true, dateCreated: true },
    orderBy: { dateCreated: 'asc' },
  })

  const firstDateByCustomer = new Map<string, string>()
  for (const o of orders) {
    if (!o.customerEmail || !o.dateCreated) continue
    const email = o.customerEmail.trim().toLowerCase()
    if (!email || firstDateByCustomer.has(email)) continue
    firstDateByCustomer.set(email, o.dateCreated.toISOString().slice(0, 10))
  }
  const dailyCount = new Map<string, number>()
  for (const dateStr of firstDateByCustomer.values()) {
    dailyCount.set(dateStr, (dailyCount.get(dateStr) ?? 0) + 1)
  }

  const allDays = eachDayOfInterval({ start: fromExtended, end: toDate })
  const getCount = (d: Date) => dailyCount.get(d.toISOString().slice(0, 10)) ?? 0
  const result: Array<{ date: string; ma90: number; ma180: number; ma365: number }> = []

  for (const day of allDays) {
    const dateStr = day.toISOString().slice(0, 10)
    if (dateStr < params.from || dateStr > params.to) continue
    const dayStart = new Date(dateStr + 'T00:00:00.000Z')
    const windows = [89, 179, 364].map((n) => {
      const ws = subDays(dayStart, n)
      const start = ws < fromExtended ? fromExtended : ws
      const days = eachDayOfInterval({ start, end: dayStart })
      return days.length > 0 ? days.reduce((s, d) => s + getCount(d), 0) / days.length : 0
    })
    result.push({ date: dateStr, ma90: windows[0]!, ma180: windows[1]!, ma365: windows[2]! })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

async function computeAcquisitionCompositionWoo(
  prismaClient: typeof prisma,
  workspace: any,
  params: { from: string; to: string }
) {
  const wooConn = await prismaClient.woocommerceConnection.findUnique({
    where: { workspaceId: workspace.id },
    select: { id: true },
  })
  const emptySummary = {
    discountsPct: 0,
    cm2Pct: 0,
    adSpendPct: 0,
    cogsPct: 0,
    variableCostsPct: 0,
    refundsPct: 0,
  }
  if (!wooConn) return { summary: emptySummary, daily: [] }

  const fromDate = new Date(params.from + 'T00:00:00.000Z')
  const toDate = new Date(params.to + 'T23:59:59.999Z')
  const fromExtended = subDays(fromDate, 6)

  const [orders, products, adSpendMaps] = await Promise.all([
    prismaClient.woocommerceOrder.findMany({
      where: {
        connectionId: wooConn.id,
        status: { notIn: [...WOO_EXCLUDED_STATUSES] },
        customerEmail: { not: null },
        dateCreated: { gte: fromExtended, lte: toDate },
      },
      select: {
        id: true,
        customerEmail: true,
        dateCreated: true,
        total: true,
        totalTax: true,
        discountTotal: true,
        totalRefund: true,
        lineItems: { select: { sku: true, quantity: true } },
      },
      orderBy: { dateCreated: 'asc' },
    }),
    prismaClient.woocommerceProduct.findMany({
      where: {
        connectionId: wooConn.id,
        sku: { not: null },
        coq: { not: null },
        status: { not: 'trash' },
      },
      select: { sku: true, coq: true },
    }),
    getWooAdSpendMaps(workspace, fromExtended, toDate),
  ])

  const cogsBySku = new Map(
    products.map((p) => [String(p.sku).trim().toLowerCase(), Number(p.coq ?? 0)])
  )

  const firstOrderByCustomer = new Map<string, string>()
  for (const o of orders) {
    if (!o.customerEmail || !o.dateCreated) continue
    const email = o.customerEmail.trim().toLowerCase()
    if (!email || firstOrderByCustomer.has(email)) continue
    firstOrderByCustomer.set(email, o.id)
  }
  const firstOrderIds = new Set(firstOrderByCustomer.values())
  const ncOrders = orders.filter((o) => firstOrderIds.has(o.id))

  type Day = {
    grossSales: number
    discounts: number
    refunds: number
    netRevenueExTax: number
    cogs: number
    variableCosts: number
    adSpend: number
    cm2: number
  }
  const byDay = new Map<string, Day>()
  for (const o of ncOrders) {
    if (!o.dateCreated) continue
    const dateStr = o.dateCreated.toISOString().slice(0, 10)
    const total = Number(o.total ?? 0)
    const tax = Number(o.totalTax ?? 0)
    const discount = Math.abs(Number(o.discountTotal ?? 0))
    const refund = Math.abs(Number(o.totalRefund ?? 0))
    const gross = total + discount
    const netExTax = total - tax - refund
    const ad = adSpendMaps.byDate.get(dateStr) ?? 0
    let cogs = 0
    for (const li of o.lineItems) {
      const sku = li.sku?.trim().toLowerCase()
      if (!sku) continue
      cogs += (cogsBySku.get(sku) ?? 0) * (li.quantity ?? 0)
    }
    const cm2 = total - cogs - ad
    const cur = byDay.get(dateStr) ?? {
      grossSales: 0,
      discounts: 0,
      refunds: 0,
      netRevenueExTax: 0,
      cogs: 0,
      variableCosts: 0,
      adSpend: 0,
      cm2: 0,
    }
    cur.grossSales += gross
    cur.discounts += discount
    cur.refunds += refund
    cur.netRevenueExTax += netExTax
    cur.cogs += cogs
    cur.adSpend += ad
    cur.cm2 += cm2
    byDay.set(dateStr, cur)
  }

  const allDays = eachDayOfInterval({ start: fromExtended, end: toDate })
  const raw = allDays.map((d) => {
    const date = d.toISOString().slice(0, 10)
    const s = byDay.get(date) ?? {
      grossSales: 0,
      discounts: 0,
      refunds: 0,
      netRevenueExTax: 0,
      cogs: 0,
      variableCosts: 0,
      adSpend: 0,
      cm2: 0,
    }
    const denom = s.netRevenueExTax !== 0 ? s.netRevenueExTax : 1
    return {
      date,
      discountsPct: s.grossSales ? (s.discounts / s.grossSales) * 100 : 0,
      refundsPct: s.grossSales ? (s.refunds / s.grossSales) * 100 : 0,
      cm2Pct: (s.cm2 / denom) * 100,
      adSpendPct: (s.adSpend / denom) * 100,
      cogsPct: (s.cogs / denom) * 100,
      variableCostsPct: (s.variableCosts / denom) * 100,
    }
  })
  const rawMap = new Map(raw.map((r) => [r.date, r]))
  const ma7 = (key: keyof (typeof raw)[number], dateStr: string) => {
    const day = new Date(dateStr + 'T00:00:00.000Z')
    const start = subDays(day, 6)
    let s = 0
    let n = 0
    for (let i = 0; i < 7; i++) {
      const t = new Date(start)
      t.setUTCDate(t.getUTCDate() + i)
      const row = rawMap.get(t.toISOString().slice(0, 10))
      if (!row) continue
      s += Number(row[key] ?? 0)
      n++
    }
    return n ? s / n : 0
  }

  const daily = allDays
    .map((d) => d.toISOString().slice(0, 10))
    .filter((d) => d >= params.from && d <= params.to)
    .map((date) => ({
      date,
      ncContributionMarginPct: ma7('cm2Pct', date),
      adSpendPct: ma7('adSpendPct', date),
      cogsPct: ma7('cogsPct', date),
      variableCostsPct: ma7('variableCostsPct', date),
      refundsPct: ma7('refundsPct', date),
      discountPct: ma7('discountsPct', date),
    }))

  const inRange = raw.filter((r) => r.date >= params.from && r.date <= params.to)
  const summary = {
    discountsPct: mean(inRange.map((r) => r.discountsPct)),
    cm2Pct: mean(inRange.map((r) => r.cm2Pct)),
    adSpendPct: mean(inRange.map((r) => r.adSpendPct)),
    cogsPct: mean(inRange.map((r) => r.cogsPct)),
    variableCostsPct: mean(inRange.map((r) => r.variableCostsPct)),
    refundsPct: mean(inRange.map((r) => r.refundsPct)),
  }
  return { summary, daily }
}
