import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

const DEFAULT_DAYS = 30
const MAX_DAYS = 90

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
  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(searchParams.get('days')) || DEFAULT_DAYS)
  )
  const view = searchParams.get('view') === 'daily' ? 'daily' : 'campaigns'

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      google_ads_connections: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          selected_customer_id: true,
          customer_ids: true,
        },
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

  const connection = workspace.google_ads_connections
  if (!connection) {
    return NextResponse.json(
      { error: 'No Google Ads connection', customerIds: [], activeCustomerId: null, totalDailyRows: 0, summary: null, byCampaign: [] },
      { status: 200 }
    )
  }

  // Use selected customer, or first if only one, or first when multiple (so we always show some data)
  const customerIds = connection.customer_ids ?? []
  const customerId =
    connection.selected_customer_id ??
    (customerIds.length >= 1 ? customerIds[0] : null)
  if (!customerId) {
    return NextResponse.json(
      {
        error: 'No Google Ads account linked yet. Connect from Dashboard.',
        customerIds: [],
        activeCustomerId: null,
        totalDailyRows: 0,
        summary: null,
        byCampaign: [],
      },
      { status: 200 }
    )
  }

  const since = new Date()
  since.setDate(since.getDate() - days)
  since.setHours(0, 0, 0, 0)

  const metrics = await prisma.google_ads_daily_metrics.findMany({
    where: {
      connection_id: connection.id,
      customer_id: customerId,
      date: { gte: since },
    },
    orderBy: { date: 'asc' },
  })

  type Agg = {
    impressions: number
    clicks: number
    spend: number
    conversions: number
    conversionValue: number
  }
  const totals: Agg = {
    impressions: 0,
    clicks: 0,
    spend: 0,
    conversions: 0,
    conversionValue: 0,
  }

  const byCampaign = new Map<
    string,
    { campaignId: string; campaignName: string } & Agg
  >()

  for (const m of metrics) {
    const spend = Number(m.spend)
    const conversions = Number(m.conversions)
    const conversionValue = Number(m.conversion_value)

    totals.impressions += m.impressions
    totals.clicks += m.clicks
    totals.spend += spend
    totals.conversions += conversions
    totals.conversionValue += conversionValue

    const key = m.campaign_id
    const existing = byCampaign.get(key)
    if (existing) {
      existing.impressions += m.impressions
      existing.clicks += m.clicks
      existing.spend += spend
      existing.conversions += conversions
      existing.conversionValue += conversionValue
    } else {
      byCampaign.set(key, {
        campaignId: m.campaign_id,
        campaignName: m.campaign_name,
        impressions: m.impressions,
        clicks: m.clicks,
        spend,
        conversions,
        conversionValue,
      })
    }
  }

  const roas = totals.spend > 0 ? totals.conversionValue / totals.spend : 0
  const byCampaignList = Array.from(byCampaign.values()).sort(
    (a, b) => b.spend - a.spend
  )

  const dailyRows =
    view === 'daily'
      ? metrics.map((m) => {
          const spend = Number(m.spend)
          const conversionValue = Number(m.conversion_value)
          return {
            date: m.date.toISOString().slice(0, 10),
            campaignId: m.campaign_id,
            campaignName: m.campaign_name,
            impressions: m.impressions,
            clicks: m.clicks,
            spend,
            conversions: Number(m.conversions),
            conversionValue,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
          }
        }).sort((a, b) => {
          const d = b.date.localeCompare(a.date)
          if (d !== 0) return d
          return b.spend - a.spend
        })
      : undefined

  return NextResponse.json({
    customerIds,
    activeCustomerId: customerId,
    totalDailyRows: metrics.length,
    view,
    summary: {
      impressions: totals.impressions,
      clicks: totals.clicks,
      spend: totals.spend,
      conversions: totals.conversions,
      conversionValue: totals.conversionValue,
      roas: Math.round(roas * 100) / 100,
      from: since.toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
      days,
    },
    byCampaign: byCampaignList.map((c) => ({
      ...c,
      roas: c.spend > 0 ? Math.round((c.conversionValue / c.spend) * 100) / 100 : 0,
    })),
    dailyRows,
  })
}
