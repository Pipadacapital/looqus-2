import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'
import { computeCohorts, getOrderDateStats } from '@/lib/cohorts/compute'
import type { CohortMetric, CohortMode } from '@/lib/cohorts/types'

const METRICS: CohortMetric[] = ['cm3', 'revenue', 'repeat', 'repurchase']
const MODES: CohortMode[] = ['post', 'cumulative', 'incr', 'pct', 'ltvcac']
const WOO_EXCLUDED_STATUSES = ['cancelled', 'failed', 'pending']

type WooCohortCustomer = {
  email: string
  firstAt: Date
  firstOrderId: string
  cohortMonth: string
  orders: Array<{ id: string; date: Date; revenue: number; cm3: number }>
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function parseDate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
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
  const from = parseDate(searchParams.get('from'))
  const to = parseDate(searchParams.get('to'))
  const metric = searchParams.get('metric') as CohortMetric | null
  const mode = searchParams.get('mode') as CohortMode | null

  if (!from || !to) {
    return NextResponse.json(
      { error: 'Missing or invalid from/to (YYYY-MM-DD)' },
      { status: 400 }
    )
  }
  const fromDate = new Date(from + 'T00:00:00.000Z')
  const toDate = new Date(to + 'T23:59:59.999Z')
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  const validMetric = metric && METRICS.includes(metric) ? metric : 'cm3'
  const validMode = mode && MODES.includes(mode) ? mode : 'post'

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
      shiprocketConnection: {
        select: { id: true, status: true },
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

  const guard = featureGuard(workspace.features as any, 'cohorts')
  if (guard) return guard

  const isWoocommerce = workspace.platform === 'WOOCOMMERCE'
  if (isWoocommerce) {
    const wooConn = await prisma.woocommerceConnection.findUnique({
      where: { workspaceId: workspace.id },
      select: { id: true, currency: true },
    })
    if (!wooConn) {
      return NextResponse.json({
        summary: {
          averageCac: 0,
          avg90DayRepeat: 0,
          averagePayback: null,
          newCustomers: 0,
        },
        rows: [],
        currency: 'USD',
      })
    }

    const toDateExtended = new Date(toDate)
    toDateExtended.setUTCDate(toDateExtended.getUTCDate() + 360)

    const [orders, products] = await Promise.all([
      prisma.woocommerceOrder.findMany({
        where: {
          connectionId: wooConn.id,
          status: { notIn: [...WOO_EXCLUDED_STATUSES] },
          customerEmail: { not: null },
          dateCreated: { gte: fromDate, lte: toDateExtended },
        },
        select: {
          id: true,
          customerEmail: true,
          dateCreated: true,
          total: true,
          lineItems: {
            select: {
              sku: true,
              quantity: true,
              total: true,
              subtotal: true,
              price: true,
            },
          },
        },
        orderBy: { dateCreated: 'asc' },
      }),
      prisma.woocommerceProduct.findMany({
        where: {
          connectionId: wooConn.id,
          sku: { not: null },
          coq: { not: null },
          status: { not: 'trash' },
        },
        select: { sku: true, coq: true },
      }),
    ])

    const meta = workspace.meta_ads_connections
    const google = workspace.google_ads_connections
    const metaIds =
      meta?.selected_ad_account_ids?.length
        ? meta.selected_ad_account_ids
        : meta?.selected_ad_account_id
          ? [meta.selected_ad_account_id]
          : undefined
    const googleIds =
      google?.selected_customer_ids?.length
        ? google.selected_customer_ids
        : google?.selected_customer_id
          ? [google.selected_customer_id]
          : undefined

    const adSpendByMonth = new Map<string, number>()
    let totalAdSpend = 0

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
      const [metaByDate, metaAgg] = await Promise.all([
        prisma.meta_ads_daily_metrics.groupBy({
          by: ['date'],
          where: metaWhere,
          _sum: { spend: true },
        }),
        prisma.meta_ads_daily_metrics.aggregate({
          where: metaWhere,
          _sum: { spend: true },
        }),
      ])
      totalAdSpend += Number(metaAgg._sum.spend ?? 0)
      for (const row of metaByDate) {
        const month = row.date.toISOString().slice(0, 7)
        adSpendByMonth.set(
          month,
          (adSpendByMonth.get(month) ?? 0) + Number(row._sum.spend ?? 0)
        )
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
      const [googleByDate, googleAgg] = await Promise.all([
        prisma.google_ads_daily_metrics.groupBy({
          by: ['date'],
          where: googleWhere,
          _sum: { spend: true },
        }),
        prisma.google_ads_daily_metrics.aggregate({
          where: googleWhere,
          _sum: { spend: true },
        }),
      ])
      totalAdSpend += Number(googleAgg._sum.spend ?? 0)
      for (const row of googleByDate) {
        const month = row.date.toISOString().slice(0, 7)
        adSpendByMonth.set(
          month,
          (adSpendByMonth.get(month) ?? 0) + Number(row._sum.spend ?? 0)
        )
      }
    }

    const cogsBySku = new Map(
      products.map((p) => [String(p.sku).trim().toLowerCase(), Number(p.coq ?? 0)])
    )

    const customerMap = new Map<string, WooCohortCustomer>()
    for (const order of orders) {
      if (!order.customerEmail || !order.dateCreated) continue
      const email = order.customerEmail.trim().toLowerCase()
      if (!email) continue

      const revenue = Number(order.total ?? 0)
      let cogs = 0
      for (const li of order.lineItems) {
        const skuKey = li.sku?.trim().toLowerCase()
        const qty = li.quantity ?? 0
        if (!skuKey || qty <= 0) continue
        cogs += (cogsBySku.get(skuKey) ?? 0) * qty
      }
      const cm3 = revenue - cogs

      const existing = customerMap.get(email)
      if (!existing) {
        customerMap.set(email, {
          email,
          firstAt: order.dateCreated,
          firstOrderId: order.id,
          cohortMonth: order.dateCreated.toISOString().slice(0, 7),
          orders: [{ id: order.id, date: order.dateCreated, revenue, cm3 }],
        })
      } else {
        existing.orders.push({ id: order.id, date: order.dateCreated, revenue, cm3 })
      }
    }

    const cohortGroups = new Map<string, WooCohortCustomer[]>()
    for (const customer of customerMap.values()) {
      if (!cohortGroups.has(customer.cohortMonth)) cohortGroups.set(customer.cohortMonth, [])
      customer.orders.sort((a, b) => a.date.getTime() - b.date.getTime())
      cohortGroups.get(customer.cohortMonth)!.push(customer)
    }

    const rows: Array<{
      cohortMonth: string
      newCustomers: number
      cac: number
      rr90: number
      payback: number | null
      firstOrder: number
      firstOrderR: number
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
    }> = []

    let totalNewCustomers = 0
    let totalRepeat90 = 0

    const sortedCohorts = Array.from(cohortGroups.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    )
    for (const [cohortMonth, customers] of sortedCohorts) {
      const newCustomers = customers.length
      totalNewCustomers += newCustomers
      const monthSpend = adSpendByMonth.get(cohortMonth) ?? 0
      const cac = newCustomers > 0 ? monthSpend / newCustomers : 0

      const firstOrderMetricVals = customers.map((c) =>
        validMetric === 'revenue' ? c.orders[0]?.revenue ?? 0 : c.orders[0]?.cm3 ?? 0
      )
      const firstOrder = mean(firstOrderMetricVals)
      const firstOrderR = firstOrder

      const bucketValues: number[] = new Array(12).fill(0)
      const repeatSetByBucket: Array<Set<string>> = Array.from(
        { length: 12 },
        () => new Set<string>()
      )
      const repurchaseCountByBucket: number[] = new Array(12).fill(0)

      let repeat90 = 0
      for (const customer of customers) {
        const first = customer.orders[0]
        if (!first) continue

        const t90 = first.date.getTime() + 90 * 24 * 60 * 60 * 1000
        const has90Repeat = customer.orders.some(
          (o) => o.id !== first.id && o.date.getTime() > first.date.getTime() && o.date.getTime() <= t90
        )
        if (has90Repeat) repeat90++

        for (const order of customer.orders) {
          if (order.id === first.id) continue
          const daysDiff =
            (order.date.getTime() - first.date.getTime()) / (1000 * 60 * 60 * 24)
          if (daysDiff < 1 || daysDiff > 360) continue
          const bucket = Math.min(12, Math.floor((daysDiff - 1) / 30) + 1)
          const idx = bucket - 1
          if (validMetric === 'cm3') {
            bucketValues[idx] += order.cm3
          } else if (validMetric === 'revenue') {
            bucketValues[idx] += order.revenue
          } else if (validMetric === 'repeat') {
            repeatSetByBucket[idx].add(customer.email)
          } else {
            repurchaseCountByBucket[idx] += 1
          }
        }
      }
      totalRepeat90 += repeat90
      const rr90 = newCustomers > 0 ? repeat90 / newCustomers : 0

      const incr = bucketValues.map((v, idx) => {
        if (validMetric === 'cm3' || validMetric === 'revenue') return v / newCustomers
        if (validMetric === 'repeat') return repeatSetByBucket[idx].size / newCustomers
        return repurchaseCountByBucket[idx] / newCustomers
      })

      let payback: number | null = null
      if (validMetric === 'cm3' || validMetric === 'revenue') {
        let cum = firstOrder - cac
        if (cum >= 0) payback = 0
        else {
          for (let k = 1; k <= 12; k++) {
            cum += incr[k - 1] ?? 0
            if (cum >= 0) {
              payback = k
              break
            }
          }
        }
      }

      let m = [...incr]
      if (validMode === 'post' && validMetric !== 'cm3') {
        let s = 0
        m = m.map((v) => (s += v))
      } else if (validMode === 'cumulative' && (validMetric === 'cm3' || validMetric === 'revenue')) {
        let s = firstOrder
        m = m.map((v) => (s += v))
      } else if (validMode === 'pct' && (validMetric === 'cm3' || validMetric === 'revenue')) {
        const denom = Math.max(Math.abs(firstOrder), 1e-9)
        let s = firstOrder
        m = m.map((v) => ((s += v) / denom) * 100)
      } else if (validMode === 'ltvcac' && (validMetric === 'cm3' || validMetric === 'revenue')) {
        const denom = Math.max(cac, 1e-9)
        let s = firstOrder
        m = m.map((v) => (s += v) / denom)
      }

      rows.push({
        cohortMonth,
        newCustomers,
        cac,
        rr90,
        payback,
        firstOrder,
        firstOrderR,
        m1: m[0] ?? 0,
        m2: m[1] ?? 0,
        m3: m[2] ?? 0,
        m4: m[3] ?? 0,
        m5: m[4] ?? 0,
        m6: m[5] ?? 0,
        m7: m[6] ?? 0,
        m8: m[7] ?? 0,
        m9: m[8] ?? 0,
        m10: m[9] ?? 0,
        m11: m[10] ?? 0,
        m12: m[11] ?? 0,
      })
    }

    const summary = {
      averageCac: totalNewCustomers > 0 ? totalAdSpend / totalNewCustomers : 0,
      avg90DayRepeat: totalNewCustomers > 0 ? totalRepeat90 / totalNewCustomers : 0,
      averagePayback:
        rows.filter((r) => r.payback != null).length > 0
          ? mean(rows.filter((r) => r.payback != null).map((r) => Number(r.payback)))
          : null,
      newCustomers: totalNewCustomers,
    }

    const anyOrderCurrency = await prisma.woocommerceOrder.findFirst({
      where: { connectionId: wooConn.id, currency: { not: null } },
      select: { currency: true },
      orderBy: { dateCreated: 'desc' },
    })
    const currency =
      wooConn.currency?.trim() || anyOrderCurrency?.currency?.trim() || 'USD'

    return NextResponse.json({ summary, rows, currency })
  }

  const result = await computeCohorts(prisma, workspace as Parameters<typeof computeCohorts>[1], {
    from,
    to,
    metric: validMetric,
    mode: validMode,
  })

  const debugParam = request.nextUrl.searchParams.get('debug')
  if (debugParam === '1') {
    const connectionId = workspace.shopifyConnections[0]?.id
    if (connectionId) {
      const stats = await getOrderDateStats(prisma, connectionId, toDate)
      ;(result as { debug?: unknown }).debug = {
        ...stats,
        hint: 'If minProcessedAt > from, run POST /api/workspaces/[slug]/shopify/backfill-orders?daysBack=400',
      }
    }
  }

  return NextResponse.json(result)
}
