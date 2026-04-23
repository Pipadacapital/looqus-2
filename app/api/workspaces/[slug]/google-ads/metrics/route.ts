import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'
import { loadCampaignIntentMap, resolveCampaignIntent } from '@/lib/metrics/campaign-classification'
import {
  addMetricToIntentBuckets,
  buildIntentSplitPayload,
  emptyIntentBuckets,
  matchesIntentFilter,
} from '@/lib/metrics/ad-intent-split'
import {
  diagnoseGoogleFunnel,
  googleMergedFunnelSnapshot,
  type PaidMediaFunnelSnapshot,
} from '@/lib/metrics/paid-media-funnel'
import {
  addFunnelDailyRow,
  emptyGoogleStagedCounts,
  hasStagedFunnelData,
} from '@/lib/metrics/google-funnel-aggregate'
import { fetchGoalRowsMap, buildGoalEvaluations } from '@/lib/metrics/goals'
import type { GoalMetricId } from '@/lib/metrics/goal-metrics-registry'

function googleFunnelWithDiagnostics(s: PaidMediaFunnelSnapshot) {
  return { ...s, diagnostics: diagnoseGoogleFunnel(s) }
}

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
  const intentFilter = searchParams.get('intent') || 'all'

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
      features: true,
      google_ads_connections: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          currency: true,
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

  const guard = featureGuard(workspace.features as any, 'google_ads')
  if (guard) return guard

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

  const [metrics, funnelDaily, intentMap] = await Promise.all([
    prisma.google_ads_daily_metrics.findMany({
      where: {
        connection_id: connection.id,
        customer_id: customerId,
        date: { gte: since, lte: toDate },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.google_ads_funnel_daily.findMany({
      where: {
        connection_id: connection.id,
        customer_id: customerId,
        date: { gte: since, lte: toDate },
      },
    }),
    loadCampaignIntentMap(prisma, workspace.id),
  ])

  const stagedByCampaign = new Map<string, ReturnType<typeof emptyGoogleStagedCounts>>()
  const stagedByCampaignDate = new Map<string, ReturnType<typeof emptyGoogleStagedCounts>>()
  const totalsStaged = emptyGoogleStagedCounts()

  for (const fr of funnelDaily) {
    addFunnelDailyRow(totalsStaged, fr)
    let sc = stagedByCampaign.get(fr.campaign_id)
    if (!sc) {
      sc = emptyGoogleStagedCounts()
      stagedByCampaign.set(fr.campaign_id, sc)
    }
    addFunnelDailyRow(sc, fr)
    const dk = `${fr.campaign_id}|${fr.date.toISOString().slice(0, 10)}`
    let sd = stagedByCampaignDate.get(dk)
    if (!sd) {
      sd = emptyGoogleStagedCounts()
      stagedByCampaignDate.set(dk, sd)
    }
    addFunnelDailyRow(sd, fr)
  }

  const intentBuckets = emptyIntentBuckets()

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
    addMetricToIntentBuckets(intentBuckets, intentMap, 'google', m.campaign_id, spend, conversionValue)

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

  const googleGoalMap = await fetchGoalRowsMap(
    prisma,
    workspace.id,
    ['google_roas'] as GoalMetricId[],
    toDate
  )
  const goalEvaluations = buildGoalEvaluations({ google_roas: roas }, googleGoalMap)
  const intentSplit = buildIntentSplitPayload(
    intentBuckets,
    totals.spend,
    totals.conversionValue
  )

  const rowRoas = (spend: number, convVal: number) =>
    spend > 0 ? Math.round((convVal / spend) * 100) / 100 : 0

  const funnelSummarySnap = googleMergedFunnelSnapshot(
    {
      impressions: totals.impressions,
      clicks: totals.clicks,
      spend: totals.spend,
      conversions: totals.conversions,
      conversionValue: totals.conversionValue,
    },
    hasStagedFunnelData(totalsStaged) ? totalsStaged : null
  )

  const byCampaignList = Array.from(byCampaign.values())
    .map((c) => {
      const intent = resolveCampaignIntent(intentMap, 'google', c.campaignId)
      const roasVal = rowRoas(c.spend, c.conversionValue)
      const staged = stagedByCampaign.get(c.campaignId)
      const f = googleMergedFunnelSnapshot(
        {
          impressions: c.impressions,
          clicks: c.clicks,
          spend: c.spend,
          conversions: c.conversions,
          conversionValue: c.conversionValue,
        },
        staged && hasStagedFunnelData(staged) ? staged : null
      )
      return {
        ...c,
        intent,
        roas: roasVal,
        acqRoas: intent === 'acquisition' ? roasVal : null,
        nonAcqRoas: intent !== 'acquisition' ? roasVal : null,
        funnel: googleFunnelWithDiagnostics(f),
      }
    })
    .filter((c) => matchesIntentFilter(c.intent, intentFilter))
    .sort((a, b) => b.spend - a.spend)

  const dailyRows =
    view === 'daily'
      ? metrics
          .map((m) => {
            const spend = Number(m.spend)
            const conversionValue = Number(m.conversion_value)
            const intent = resolveCampaignIntent(intentMap, 'google', m.campaign_id)
            const dateKey = `${m.campaign_id}|${m.date.toISOString().slice(0, 10)}`
            const dayStaged = stagedByCampaignDate.get(dateKey)
            const f = googleMergedFunnelSnapshot(
              {
                impressions: m.impressions,
                clicks: m.clicks,
                spend,
                conversions: Number(m.conversions),
                conversionValue,
              },
              dayStaged && hasStagedFunnelData(dayStaged) ? dayStaged : null
            )
            return {
              date: m.date.toISOString().slice(0, 10),
              campaignId: m.campaign_id,
              campaignName: m.campaign_name,
              impressions: m.impressions,
              clicks: m.clicks,
              spend,
              conversions: Number(m.conversions),
              conversionValue,
              intent,
              roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
              funnel: googleFunnelWithDiagnostics(f),
            }
          })
          .filter((r) => matchesIntentFilter(r.intent, intentFilter))
          .sort((a, b) => {
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
    intentFilter,
    intentSplit,
    summary: {
      impressions: totals.impressions,
      clicks: totals.clicks,
      spend: totals.spend,
      conversions: totals.conversions,
      conversionValue: totals.conversionValue,
      roas: Math.round(roas * 100) / 100,
      from: since.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      days: Math.round((toDate.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)) + 1,
      goalEvaluations,
    },
    byCampaign: byCampaignList,
    dailyRows,
    funnel: {
      coverage: funnelSummarySnap.coverage,
      summary: googleFunnelWithDiagnostics(funnelSummarySnap),
      hasStagedData: hasStagedFunnelData(totalsStaged),
      note:
        funnelSummarySnap.coverage === 'google_full'
          ? 'Stages from conversion actions (ADD_TO_CART, BEGIN_CHECKOUT, PURCHASE). ATC/checkout use all_conversions; purchase count prefers conversions then all_conversions; ROAS uses purchase-stage value when present.'
          : 'No staged funnel rows in range — run Google Ads sync after upgrading. Until then funnel shows aggregate conversions only.',
    },
    currency: connection.currency ?? 'USD',
  })
}
