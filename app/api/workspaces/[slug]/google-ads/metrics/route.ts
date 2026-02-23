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
      { error: 'No Google Ads connection', summary: null, byCampaign: [] },
      { status: 200 }
    )
  }

  const customerId =
    connection.selected_customer_id ??
    (connection.customer_ids?.length === 1 ? connection.customer_ids[0] : null)
  if (!customerId) {
    return NextResponse.json(
      { error: 'Select a Google Ads customer first', summary: null, byCampaign: [] },
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

  return NextResponse.json({
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
  })
}
