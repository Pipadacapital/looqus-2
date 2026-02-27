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
  const groupBy = searchParams.get('groupBy') === 'adset' ? 'adset' : 'campaign'

  let since: Date
  let toDate: Date
  const fromStr = searchParams.get('from')
  const toStr = searchParams.get('to')
  if (fromStr && toStr) {
    // Use UTC boundaries so the same calendar day is used regardless of server timezone (matches shopify-analytics).
    since = new Date(`${fromStr}T00:00:00.000Z`)
    toDate = new Date(`${toStr}T23:59:59.999Z`)
    if (Number.isNaN(since.getTime()) || Number.isNaN(toDate.getTime()) || since > toDate) {
      toDate = new Date()
      since = new Date()
      since.setUTCDate(since.getUTCDate() - days)
      since.setUTCHours(0, 0, 0, 0)
    }
  } else {
    toDate = new Date()
    since = new Date()
    since.setUTCDate(since.getUTCDate() - days)
    since.setUTCHours(0, 0, 0, 0)
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      meta_ads_connections: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          selected_ad_account_id: true,
          ad_account_ids: true,
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

  const connection = workspace.meta_ads_connections
  if (!connection) {
    return NextResponse.json(
      {
        error: 'No Meta Ads connection',
        adAccountIds: [],
        activeAdAccountId: null,
        totalDailyRows: 0,
        summary: null,
        byCampaign: [],
        byAdset: [],
        dailyRows: undefined,
      },
      { status: 200 }
    )
  }

  const adAccountIds = connection.ad_account_ids ?? []
  const adAccountId =
    connection.selected_ad_account_id ??
    (adAccountIds.length >= 1 ? adAccountIds[0] : null)

  if (!adAccountId) {
    return NextResponse.json(
      {
        error: 'No Meta Ads account selected. Select one from the Dashboard.',
        adAccountIds: [],
        activeAdAccountId: null,
        totalDailyRows: 0,
        summary: null,
        byCampaign: [],
        byAdset: [],
        dailyRows: undefined,
      },
      { status: 200 }
    )
  }

  const metrics = await prisma.meta_ads_daily_metrics.findMany({
    where: {
      connection_id: connection.id,
      ad_account_id: adAccountId,
      date: { gte: since, lte: toDate },
    },
    orderBy: { date: 'asc' },
  })

  const totals = {
    impressions: 0,
    clicks: 0,
    spend: 0,
    conversions: 0,
    revenue: 0,
  }

  const byCampaignMap = new Map<
    string,
    { campaignId: string; campaignName: string; impressions: number; clicks: number; spend: number; conversions: number; revenue: number }
  >()
  const byAdsetMap = new Map<
    string,
    { campaignId: string; campaignName: string; adsetId: string; adsetName: string; impressions: number; clicks: number; spend: number; conversions: number; revenue: number }
  >()

  for (const m of metrics) {
    const spend = Number(m.spend)
    const revenue = Number(m.revenue)

    totals.impressions += m.impressions
    totals.clicks += m.clicks
    totals.spend += spend
    totals.conversions += m.conversions
    totals.revenue += revenue

    const cKey = m.campaign_id
    const cExisting = byCampaignMap.get(cKey)
    if (cExisting) {
      cExisting.impressions += m.impressions
      cExisting.clicks += m.clicks
      cExisting.spend += spend
      cExisting.conversions += m.conversions
      cExisting.revenue += revenue
    } else {
      byCampaignMap.set(cKey, {
        campaignId: m.campaign_id,
        campaignName: m.campaign_name,
        impressions: m.impressions,
        clicks: m.clicks,
        spend,
        conversions: m.conversions,
        revenue,
      })
    }

    const aKey = m.adset_id ?? `${cKey}__no_adset`
    const aExisting = byAdsetMap.get(aKey)
    if (aExisting) {
      aExisting.impressions += m.impressions
      aExisting.clicks += m.clicks
      aExisting.spend += spend
      aExisting.conversions += m.conversions
      aExisting.revenue += revenue
    } else {
      byAdsetMap.set(aKey, {
        campaignId: m.campaign_id,
        campaignName: m.campaign_name,
        adsetId: m.adset_id ?? '',
        adsetName: m.adset_name ?? '—',
        impressions: m.impressions,
        clicks: m.clicks,
        spend,
        conversions: m.conversions,
        revenue,
      })
    }
  }

  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0
  const byCampaignList = Array.from(byCampaignMap.values())
    .map((c) => ({
      ...c,
      roas: c.spend > 0 ? Math.round((c.revenue / c.spend) * 100) / 100 : 0,
      ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
      cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
      cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
    }))
    .sort((a, b) => b.spend - a.spend)

  const byAdsetList = Array.from(byAdsetMap.values())
    .map((a) => ({
      ...a,
      roas: a.spend > 0 ? Math.round((a.revenue / a.spend) * 100) / 100 : 0,
      ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
      cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
      cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
    }))
    .sort((a, b) => b.spend - a.spend)

  const dailyRows =
    view === 'daily'
      ? metrics
          .map((m) => {
            const spend = Number(m.spend)
            const revenue = Number(m.revenue)
            return {
              date: m.date.toISOString().slice(0, 10),
              campaignId: m.campaign_id,
              campaignName: m.campaign_name,
              adsetId: m.adset_id ?? '',
              adsetName: m.adset_name ?? '—',
              impressions: m.impressions,
              clicks: m.clicks,
              spend,
              conversions: m.conversions,
              revenue,
              roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
              ctr: m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0,
              cpc: m.clicks > 0 ? spend / m.clicks : 0,
              cpm: m.impressions > 0 ? (spend / m.impressions) * 1000 : 0,
            }
          })
          .sort((a, b) => {
            const d = b.date.localeCompare(a.date)
            if (d !== 0) return d
            return b.spend - a.spend
          })
      : undefined

  return NextResponse.json({
    adAccountIds,
    activeAdAccountId: adAccountId,
    totalDailyRows: metrics.length,
    view,
    groupBy,
    summary: {
      impressions: totals.impressions,
      clicks: totals.clicks,
      spend: totals.spend,
      conversions: totals.conversions,
      revenue: totals.revenue,
      roas: Math.round(roas * 100) / 100,
      from: since.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      days: Math.round((toDate.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)) + 1,
    },
    byCampaign: byCampaignList,
    byAdset: byAdsetList,
    dailyRows,
  })
}
