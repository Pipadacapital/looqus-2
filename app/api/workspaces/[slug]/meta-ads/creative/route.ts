import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { loadCampaignIntentMap, resolveCampaignIntent } from '@/lib/metrics/campaign-classification'
import { matchesIntentFilter } from '@/lib/metrics/ad-intent-split'
import {
  addCreativeDailyToAggregate,
  aggregatesToVideoCreativeMetrics,
  diagnosticLabel,
  emptyMetaVideoAggregates,
  type MetaVideoCreativeDiagnostic,
} from '@/lib/metrics/meta-video-creative'

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
  const days = Math.min(MAX_DAYS, Math.max(1, Number(searchParams.get('days')) || DEFAULT_DAYS))
  const intentFilter = searchParams.get('intent') || 'all'

  let since: Date
  let toDate: Date
  const fromStr = searchParams.get('from')
  const toStr = searchParams.get('to')
  if (fromStr && toStr) {
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
    return NextResponse.json({
      ads: [],
      activeAdAccountId: null,
      totalDailyRows: 0,
      from: since.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      intentFilter,
      note: 'No Meta Ads connection.',
    })
  }

  const adAccountIds = connection.ad_account_ids ?? []
  const adAccountId =
    connection.selected_ad_account_id ??
    (adAccountIds.length >= 1 ? adAccountIds[0] : null)

  if (!adAccountId) {
    return NextResponse.json({
      ads: [],
      activeAdAccountId: null,
      totalDailyRows: 0,
      from: since.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      intentFilter,
      note: 'Select a Meta ad account on the Dashboard.',
    })
  }

  const [rows, intentMap] = await Promise.all([
    prisma.meta_ads_creative_daily.findMany({
      where: {
        connection_id: connection.id,
        ad_account_id: adAccountId,
        date: { gte: since, lte: toDate },
      },
      orderBy: [{ date: 'asc' }],
    }),
    loadCampaignIntentMap(prisma, workspace.id),
  ])

  type AggEntry = {
    agg: ReturnType<typeof emptyMetaVideoAggregates>
    adId: string
    adName: string
    campaignId: string
    campaignName: string
    adsetId: string | null
    adsetName: string | null
  }

  const byAd = new Map<string, AggEntry>()

  for (const r of rows) {
    let e = byAd.get(r.ad_id)
    if (!e) {
      e = {
        agg: emptyMetaVideoAggregates(),
        adId: r.ad_id,
        adName: r.ad_name,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        adsetId: r.adset_id,
        adsetName: r.adset_name,
      }
      byAd.set(r.ad_id, e)
    }
    addCreativeDailyToAggregate(e.agg, {
      impressions: r.impressions,
      clicks: r.clicks,
      spend: Number(r.spend),
      video_3s_views: r.video_3s_views,
      video_thruplay: r.video_thruplay,
      avg_watch_sec: r.avg_watch_sec,
      video_p25: r.video_p25,
      video_p50: r.video_p50,
      video_p75: r.video_p75,
      video_p95: r.video_p95,
      conversions: r.conversions,
      revenue: r.revenue,
    })
    e.adName = r.ad_name
    e.campaignName = r.campaign_name
    e.adsetId = r.adset_id
    e.adsetName = r.adset_name
    e.campaignId = r.campaign_id
  }

  const ads = Array.from(byAd.values())
    .map((e) =>
      aggregatesToVideoCreativeMetrics(
        {
          adId: e.adId,
          adName: e.adName,
          campaignId: e.campaignId,
          campaignName: e.campaignName,
          adsetId: e.adsetId,
          adsetName: e.adsetName,
        },
        e.agg
      )
    )
    .filter((m) =>
      matchesIntentFilter(resolveCampaignIntent(intentMap, 'meta', m.campaignId), intentFilter)
    )
    .sort((a, b) => b.spend - a.spend)
    .map((m) => {
      const intent = resolveCampaignIntent(intentMap, 'meta', m.campaignId)
      return {
        adId: m.adId,
        adName: m.adName,
        campaignId: m.campaignId,
        campaignName: m.campaignName,
        adsetId: m.adsetId,
        adsetName: m.adsetName,
        intent,
        impressions: m.impressions,
        clicks: m.clicks,
        spend: m.spend,
        isVideo: m.isVideo,
        hookRatePct: m.hookRatePct,
        holdRatePct: m.holdRatePct,
        p25RatePct: m.p25RatePct,
        p50RatePct: m.p50RatePct,
        p75RatePct: m.p75RatePct,
        p95RatePct: m.p95RatePct,
        avgWatchSec: m.avgWatchSec,
        ctrPct: m.ctrPct,
        roas: m.roas,
        conversions: m.conversions,
        diagnostics: m.diagnostics,
        diagnosticLabels: m.diagnostics.map((d: MetaVideoCreativeDiagnostic) =>
          diagnosticLabel(d)
        ),
      }
    })

  let note: string | undefined
  if (rows.length === 0) {
    note =
      'No ad-level creative rows in this range. After deploy, run Meta sync (Dashboard or Admin) to backfill ad insights.'
  }

  return NextResponse.json({
    ads,
    activeAdAccountId: adAccountId,
    totalDailyRows: rows.length,
    from: since.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    intentFilter,
    note,
    formulasNote:
      'Hook/Hold use days where Meta returns 3_second_video_view in actions; otherwise Hook/Hold show N/A. Quartiles = Meta counts÷impr; avg watch weighted by impr; ROAS = purchase value÷spend.',
  })
}
