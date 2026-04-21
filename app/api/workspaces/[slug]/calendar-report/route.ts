import { NextResponse, type NextRequest } from 'next/server'
import {
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
} from 'date-fns'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { normalizeOrderFilterSettings } from '@/lib/order-filters'
import {
  computeCalendarReport,
  MAX_CALENDAR_DAYS,
} from '@/lib/metrics/calendar-report'

function monthBounds(ym: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null
  const d = parseISO(`${ym}-01T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return {
    from: format(startOfMonth(d), 'yyyy-MM-dd'),
    to: format(endOfMonth(d), 'yyyy-MM-dd'),
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const monthParam = searchParams.get('month')
  let from = searchParams.get('from') ?? ''
  let to = searchParams.get('to') ?? ''

  if (monthParam) {
    const b = monthBounds(monthParam.trim())
    if (!b) {
      return NextResponse.json({ error: 'Invalid month (use YYYY-MM)' }, { status: 400 })
    }
    from = b.from
    to = b.to
  }

  const g = searchParams.get('granularity') ?? 'day'
  const granularity = g === 'week' ? 'week' : g === 'month' ? 'month' : 'day'

  if (!from || !to) {
    return NextResponse.json(
      { error: 'Provide month=YYYY-MM or from and to (max one calendar month)' },
      { status: 400 }
    )
  }

  const fromD = parseISO(`${from}T00:00:00.000Z`)
  const toD = parseISO(`${to}T23:59:59.999Z`)
  const spanDays =
    Math.floor((toD.getTime() - fromD.getTime()) / 86400000) + 1
  if (spanDays > MAX_CALENDAR_DAYS || spanDays < 1) {
    return NextResponse.json(
      { error: `Range must be 1–${MAX_CALENDAR_DAYS} days (one month)` },
      { status: 400 }
    )
  }

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

  if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  })
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isWoocommerce = workspace.platform === 'WOOCOMMERCE'
  if (isWoocommerce) {
    const wooConn = await prisma.woocommerceConnection.findUnique({
      where: { workspaceId: workspace.id },
      select: { id: true, currency: true },
    })
    if (!wooConn) {
      return NextResponse.json({
        rows: [],
        currency: 'USD',
        actionTypes: [],
        error: 'Connect WooCommerce to load calendar metrics.',
      })
    }

    const [orders, products, actions, klaviyoSends] = await Promise.all([
      prisma.woocommerceOrder.findMany({
        where: {
          connectionId: wooConn.id,
          status: { notIn: ['cancelled', 'failed', 'pending'] },
          dateCreated: {
            gte: new Date(from + 'T00:00:00.000Z'),
            lte: new Date(to + 'T23:59:59.999Z'),
          },
          customerEmail: { not: null },
        },
        select: {
          id: true,
          customerEmail: true,
          dateCreated: true,
          total: true,
          totalTax: true,
          totalRefund: true,
          lineItems: { select: { sku: true, quantity: true } },
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
      prisma.marketingAction.findMany({
        where: {
          workspaceId: workspace.id,
          actionDate: {
            gte: new Date(from + 'T00:00:00.000Z'),
            lte: new Date(to + 'T23:59:59.999Z'),
          },
        },
        orderBy: [{ actionDate: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.emailPerformance.findMany({
        where: {
          workspaceId: workspace.id,
          sourceType: 'campaign',
          sendDate: {
            gte: new Date(from + 'T00:00:00.000Z'),
            lte: new Date(to + 'T23:59:59.999Z'),
          },
        },
      }),
    ])

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
    const [metaDaily, googleDaily] = await Promise.all([
      meta?.id
        ? prisma.meta_ads_daily_metrics.groupBy({
            by: ['date'],
            where: {
              connection_id: meta.id,
              date: {
                gte: new Date(from + 'T00:00:00.000Z'),
                lte: new Date(to + 'T23:59:59.999Z'),
              },
              ...(metaIds?.length ? { ad_account_id: { in: metaIds } } : {}),
            },
            _sum: { spend: true },
          })
        : Promise.resolve([]),
      google?.id
        ? prisma.google_ads_daily_metrics.groupBy({
            by: ['date'],
            where: {
              connection_id: google.id,
              date: {
                gte: new Date(from + 'T00:00:00.000Z'),
                lte: new Date(to + 'T23:59:59.999Z'),
              },
              ...(googleIds?.length ? { customer_id: { in: googleIds } } : {}),
            },
            _sum: { spend: true },
          })
        : Promise.resolve([]),
    ])

    const cogsBySku = new Map(
      products.map((p) => [String(p.sku).trim().toLowerCase(), Number(p.coq ?? 0)])
    )
    const anyOrderCurrency = await prisma.woocommerceOrder.findFirst({
      where: { connectionId: wooConn.id, currency: { not: null } },
      select: { currency: true },
      orderBy: { dateCreated: 'desc' },
    })
    const resolvedCurrency =
      wooConn.currency?.trim() || anyOrderCurrency?.currency?.trim() || 'USD'
    const adByDate = new Map<string, number>()
    for (const r of metaDaily) {
      const d = r.date.toISOString().slice(0, 10)
      adByDate.set(d, (adByDate.get(d) ?? 0) + Number(r._sum.spend ?? 0))
    }
    for (const r of googleDaily) {
      const d = r.date.toISOString().slice(0, 10)
      adByDate.set(d, (adByDate.get(d) ?? 0) + Number(r._sum.spend ?? 0))
    }

    const firstOrderByEmail = new Map<string, string>()
    for (const o of orders) {
      const email = o.customerEmail?.trim().toLowerCase()
      if (!email || !o.dateCreated) continue
      if (!firstOrderByEmail.has(email)) {
        firstOrderByEmail.set(email, o.dateCreated.toISOString().slice(0, 10))
      }
    }

    type DayAgg = {
      revenue: number
      cm3: number
      totalSpend: number
      newCustomers: number
      totalOrders: number
      acquisitionAdSpend: number
      ncRevenue: number
    }
    const byDay = new Map<string, DayAgg>()
    for (const o of orders) {
      if (!o.dateCreated) continue
      const dateStr = o.dateCreated.toISOString().slice(0, 10)
      const total = Number(o.total ?? 0)
      const tax = Number(o.totalTax ?? 0)
      const refund = Number(o.totalRefund ?? 0)
      let cogs = 0
      for (const li of o.lineItems) {
        const sku = li.sku?.trim().toLowerCase()
        if (!sku) continue
        cogs += (cogsBySku.get(sku) ?? 0) * (li.quantity ?? 0)
      }
      const revenue = total - tax - refund
      const dayAd = adByDate.get(dateStr) ?? 0
      const cm3 = revenue - cogs - dayAd
      const email = o.customerEmail?.trim().toLowerCase() ?? ''
      const isNew = email ? firstOrderByEmail.get(email) === dateStr : false

      const cur = byDay.get(dateStr) ?? {
        revenue: 0,
        cm3: 0,
        totalSpend: 0,
        newCustomers: 0,
        totalOrders: 0,
        acquisitionAdSpend: 0,
        ncRevenue: 0,
      }
      cur.revenue += revenue
      cur.cm3 += cm3
      cur.totalSpend = dayAd
      cur.totalOrders += 1
      if (isNew) {
        cur.newCustomers += 1
        cur.ncRevenue += revenue
      }
      cur.acquisitionAdSpend = dayAd
      byDay.set(dateStr, cur)
    }

    const actionsByDate = new Map<string, typeof actions>()
    for (const a of actions) {
      const k = a.actionDate.toISOString().slice(0, 10)
      if (!actionsByDate.has(k)) actionsByDate.set(k, [])
      actionsByDate.get(k)!.push(a)
    }
    const klaviyoByDate = new Map<string, typeof klaviyoSends>()
    for (const e of klaviyoSends) {
      const k = e.sendDate.toISOString().slice(0, 10)
      if (!klaviyoByDate.has(k)) klaviyoByDate.set(k, [])
      klaviyoByDate.get(k)!.push(e)
    }

    const days = eachDayOfInterval({
      start: new Date(from + 'T00:00:00.000Z'),
      end: new Date(to + 'T00:00:00.000Z'),
    }).map((d) => d.toISOString().slice(0, 10))

    function buildRow(periodKey: string, label: string, dateList: string[]) {
      let revenue = 0
      let cm3 = 0
      let totalSpend = 0
      let newCustomers = 0
      let totalOrders = 0
      let acquisitionAdSpend = 0
      let ncRevenue = 0
      for (const ds of dateList) {
        const sl = byDay.get(ds)
        if (!sl) continue
        revenue += sl.revenue
        cm3 += sl.cm3
        totalSpend += sl.totalSpend
        newCustomers += sl.newCustomers
        totalOrders += sl.totalOrders
        acquisitionAdSpend += sl.acquisitionAdSpend
        ncRevenue += sl.ncRevenue
      }
      const mer = totalSpend > 0 ? revenue / totalSpend : null
      const amer = acquisitionAdSpend > 0 ? ncRevenue / acquisitionAdSpend : null
      const cac = newCustomers > 0 ? totalSpend / newCustomers : null
      const aov = totalOrders > 0 ? revenue / totalOrders : null

      const actionItems = dateList.flatMap((ds) => {
        const manual = (actionsByDate.get(ds) ?? []).map((a) => ({
          id: a.id,
          actionDate: a.actionDate.toISOString().slice(0, 10),
          actionType: a.actionType,
          actionName: a.actionName,
          notes: a.notes,
          source: 'manual' as const,
        }))
        const klv = (klaviyoByDate.get(ds) ?? []).map((e) => ({
          id: `klaviyo-${e.id}`,
          actionDate: ds,
          actionType: e.channel === 'sms' ? 'sms_campaign' : 'email_campaign',
          actionName: e.name,
          notes: `Klaviyo · ${e.delivered} delivered · ${Number(e.revenue).toFixed(0)} rev`,
          source: 'klaviyo' as const,
        }))
        return [...manual, ...klv]
      })

      return {
        periodKey,
        label,
        actions: [...new Map(actionItems.map((x) => [x.id, x])).values()],
        revenue: { actual: revenue, goal: null, rag: null },
        cm3: { actual: cm3, goal: null, rag: null },
        totalSpend,
        mer: { actual: mer, goal: null, rag: null },
        amer: { actual: amer, goal: null, rag: null },
        newCustomers: { actual: newCustomers, goal: null, rag: null },
        cac: { actual: cac, goal: null, rag: null },
        aov: { actual: aov, goal: null, rag: null },
      }
    }

    const rows: Array<ReturnType<typeof buildRow>> = []
    if (granularity === 'day') {
      for (const ds of days) rows.push(buildRow(ds, ds, [ds]))
    } else if (granularity === 'week') {
      const weekStarts = new Set<string>()
      for (const ds of days) {
        const d = parseISO(`${ds}T12:00:00.000Z`)
        weekStarts.add(format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
      }
      for (const wk of [...weekStarts].sort()) {
        const ws = parseISO(`${wk}T12:00:00.000Z`)
        const we = endOfWeek(ws, { weekStartsOn: 1 })
        const bucketDates = days.filter((ds) => {
          const d = parseISO(`${ds}T12:00:00.000Z`)
          return d >= ws && d <= we
        })
        rows.push(
          buildRow(
            `w-${wk}`,
            `${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`,
            bucketDates
          )
        )
      }
    } else {
      const byMonth = new Map<string, string[]>()
      for (const ds of days) {
        const mk = ds.slice(0, 7)
        if (!byMonth.has(mk)) byMonth.set(mk, [])
        byMonth.get(mk)!.push(ds)
      }
      for (const [mk, dlist] of [...byMonth.entries()].sort((a, b) =>
        a[0].localeCompare(b[0])
      )) {
        const d0 = parseISO(`${dlist[0]}T12:00:00.000Z`)
        rows.push(
          buildRow(`m-${mk}`, format(startOfMonth(d0), 'MMMM yyyy'), dlist)
        )
      }
    }

    return NextResponse.json({
      rows,
      currency: resolvedCurrency,
      granularity,
      from,
      to,
      month: monthParam ?? `${from.slice(0, 7)}`,
      maxDays: MAX_CALENDAR_DAYS,
    })
  }

  if (!workspace.shopifyConnections[0]) {
    return NextResponse.json({
      rows: [],
      currency: 'INR',
      actionTypes: [],
      error: 'Connect Shopify to load calendar metrics.',
    })
  }

  const orderFilterSettings = normalizeOrderFilterSettings({
    skippedShopifyOrderTags: workspace.skipped_shopify_order_tags ?? [],
    skipZeroSalesOrders: workspace.skip_zero_sales_orders ?? false,
  })

  const wsMetrics = {
    id: workspace.id,
    shopifyConnections: workspace.shopifyConnections,
    cogsSettings: workspace.cogsSettings,
    meta_ads_connections: workspace.meta_ads_connections
      ? {
          id: workspace.meta_ads_connections.id,
          selected_ad_account_ids:
            workspace.meta_ads_connections.selected_ad_account_ids ?? [],
          selected_ad_account_id: workspace.meta_ads_connections.selected_ad_account_id,
        }
      : null,
    google_ads_connections: workspace.google_ads_connections
      ? {
          id: workspace.google_ads_connections.id,
          selected_customer_ids:
            workspace.google_ads_connections.selected_customer_ids ?? [],
          selected_customer_id: workspace.google_ads_connections.selected_customer_id,
        }
      : null,
    shiprocketConnection: workspace.shiprocketConnection,
  }

  const wsAcq = {
    id: workspace.id,
    shopifyConnections: workspace.shopifyConnections,
    cogsSettings: workspace.cogsSettings,
    meta_ads_connections: workspace.meta_ads_connections,
    google_ads_connections: workspace.google_ads_connections,
    skippedShopifyOrderTags: workspace.skipped_shopify_order_tags,
    skipZeroSalesOrders: workspace.skip_zero_sales_orders,
  }

  try {
    const { rows, currency } = await computeCalendarReport(
      prisma,
      wsMetrics as any,
      wsAcq as any,
      workspace.id,
      { from, to, granularity },
      orderFilterSettings
    )
    return NextResponse.json({
      rows,
      currency,
      granularity,
      from,
      to,
      month: monthParam ?? `${from.slice(0, 7)}`,
      maxDays: MAX_CALENDAR_DAYS,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('max')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('[calendar-report]', e)
    return NextResponse.json({ error: 'Failed to build calendar' }, { status: 500 })
  }
}
