import { NextResponse, type NextRequest } from 'next/server'
import { endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
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
