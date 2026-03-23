import type { PrismaClient } from '@prisma/client'
import { loadCampaignIntentMap, resolveCampaignIntent, type ClassificationKey } from '@/lib/metrics/campaign-classification'
import type { CampaignIntent } from '@/lib/metrics/types'
import {
  addMetaDailyRowToAccumulator,
  accumulatorToMetaSnapshot,
  emptyMetaFunnelAccumulator,
} from '@/lib/metrics/paid-media-funnel'
import { fetchGoalRowsMap, buildGoalEvaluations } from '@/lib/metrics/goals'
import type { GoalMetricId } from '@/lib/metrics/goal-metrics-registry'
import type { PageContext, CompressedDailyRow, GoalContext } from './types'

function computePriorPeriod(from: Date, to: Date) {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

type CampaignSummary = {
  name: string
  intent: string
  spend: number
  revenue: number
  roas: number
  impressions: number
  clicks: number
  conversions: number
  ctr: number
  cpc: number
  atcRate: number | null
  checkoutFromAtc: number | null
  purchaseFromCheckout: number | null
  overallCvr: number
}

async function computeMetaData(
  prisma: PrismaClient,
  connectionId: string,
  adAccountId: string,
  intentMap: Map<ClassificationKey, CampaignIntent>,
  fromDate: Date,
  toDate: Date
): Promise<{
  summary: Record<string, number | null>
  daily: CompressedDailyRow[]
  campaigns: CampaignSummary[]
}> {
  const metrics = await prisma.meta_ads_daily_metrics.findMany({
    where: {
      connection_id: connectionId,
      ad_account_id: adAccountId,
      date: { gte: fromDate, lte: toDate },
    },
    orderBy: { date: 'asc' },
  })

  if (metrics.length === 0) {
    return { summary: {}, daily: [], campaigns: [] }
  }

  const totalAcc = emptyMetaFunnelAccumulator()
  const acqAcc = emptyMetaFunnelAccumulator()
  const retAcc = emptyMetaFunnelAccumulator()

  // Daily aggregation keyed by date
  const dailyMap = new Map<string, {
    spend: number; revenue: number; impressions: number; clicks: number; conversions: number
  }>()

  // Campaign aggregation
  const campaignMap = new Map<string, {
    campaignId: string
    campaignName: string
    intent: string
    acc: ReturnType<typeof emptyMetaFunnelAccumulator>
  }>()

  for (const m of metrics) {
    const spend = Number(m.spend)
    const revenue = Number(m.revenue)
    const intent = resolveCampaignIntent(intentMap, 'meta', m.campaign_id)

    const row = {
      impressions: m.impressions,
      clicks: m.clicks,
      spend,
      conversions: m.conversions,
      revenue,
      raw_json: m.raw_json,
    }

    addMetaDailyRowToAccumulator(totalAcc, row)
    if (intent === 'acquisition') {
      addMetaDailyRowToAccumulator(acqAcc, row)
    } else {
      addMetaDailyRowToAccumulator(retAcc, row)
    }

    const dateStr = m.date.toISOString().slice(0, 10)
    const dayEntry = dailyMap.get(dateStr)
    if (dayEntry) {
      dayEntry.spend += spend
      dayEntry.revenue += revenue
      dayEntry.impressions += m.impressions
      dayEntry.clicks += m.clicks
      dayEntry.conversions += m.conversions
    } else {
      dailyMap.set(dateStr, {
        spend, revenue,
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: m.conversions,
      })
    }

    const cEntry = campaignMap.get(m.campaign_id)
    if (cEntry) {
      addMetaDailyRowToAccumulator(cEntry.acc, row)
    } else {
      const acc = emptyMetaFunnelAccumulator()
      addMetaDailyRowToAccumulator(acc, row)
      campaignMap.set(m.campaign_id, {
        campaignId: m.campaign_id,
        campaignName: m.campaign_name,
        intent,
        acc,
      })
    }
  }

  const totalSnap = accumulatorToMetaSnapshot(totalAcc)
  const acqSnap = accumulatorToMetaSnapshot(acqAcc)
  const retSnap = accumulatorToMetaSnapshot(retAcc)

  // Top 5 campaigns by spend
  const campaigns: CampaignSummary[] = Array.from(campaignMap.values())
    .map(c => {
      const snap = accumulatorToMetaSnapshot(c.acc)
      return {
        name: c.campaignName.length > 35 ? c.campaignName.slice(0, 35) + '…' : c.campaignName,
        intent: c.intent,
        spend: Math.round(snap.spend),
        revenue: Math.round(snap.attributedRevenue),
        roas: snap.roas,
        impressions: snap.impressions,
        clicks: snap.clicks,
        conversions: snap.purchases,
        ctr: snap.ctrPct,
        cpc: snap.clicks > 0 ? Math.round(snap.spend / snap.clicks) : 0,
        atcRate: snap.atcRatePct,
        checkoutFromAtc: snap.checkoutPerAtcPct,
        purchaseFromCheckout: snap.purchasePerCheckoutPct,
        overallCvr: snap.overallCvrPct,
      }
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 6)

  // Daily rows capped at 30
  const daily: CompressedDailyRow[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, d]) => ({
      date,
      spend: Math.round(d.spend),
      revenue: Math.round(d.revenue),
      roas: d.spend > 0 ? Math.round((d.revenue / d.spend) * 100) / 100 : 0,
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.conversions,
    }))

  const summary: Record<string, number | null> = {
    // Totals
    totalSpend: Math.round(totalSnap.spend),
    totalRevenue: Math.round(totalSnap.attributedRevenue),
    totalImpressions: totalSnap.impressions,
    totalClicks: totalSnap.clicks,
    totalConversions: totalSnap.purchases,
    roas: totalSnap.roas,
    ctr: totalSnap.ctrPct,
    cpc: totalSnap.clicks > 0 ? Math.round(totalSnap.spend / totalSnap.clicks) : 0,
    cpm: totalSnap.impressions > 0 ? Math.round((totalSnap.spend / totalSnap.impressions) * 1000) : 0,
    overallCvr: totalSnap.overallCvrPct,
    // Funnel stages
    addToCart: totalAcc.addToCart,
    checkoutInitiated: totalAcc.checkoutInitiated,
    atcRatePct: totalSnap.atcRatePct,
    checkoutPerAtcPct: totalSnap.checkoutPerAtcPct,
    purchasePerCheckoutPct: totalSnap.purchasePerCheckoutPct,
    costPerAtc: totalSnap.costPerAtc,
    costPerCheckout: totalSnap.costPerCheckout,
    costPerPurchase: totalSnap.costPerPurchase,
    // Acquisition split
    acqSpend: Math.round(acqSnap.spend),
    acqRevenue: Math.round(acqSnap.attributedRevenue),
    acqRoas: acqSnap.roas,
    acqSpendPct: totalSnap.spend > 0
      ? Math.round((acqSnap.spend / totalSnap.spend) * 10000) / 100
      : 0,
    retSpend: Math.round(retSnap.spend),
    retRevenue: Math.round(retSnap.attributedRevenue),
    retRoas: retSnap.roas,
  }

  return { summary, daily, campaigns }
}

export async function buildMetaAdsContext(
  prisma: PrismaClient,
  workspaceId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<PageContext> {
  const priorRange = computePriorPeriod(dateFrom, dateTo)

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      id: true,
      meta_ads_connections: {
        where: { status: 'CONNECTED' },
        select: { id: true, selected_ad_account_id: true, ad_account_ids: true },
      },
    },
  })

  const conn = workspace.meta_ads_connections
  const empty: PageContext = {
    page: 'meta-ads',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: {},
    priorSummary: {},
    daily: [],
    currency: 'INR',
  }

  if (!conn) return empty

  const adAccountId = conn.selected_ad_account_id ?? conn.ad_account_ids?.[0] ?? null
  if (!adAccountId) return empty

  const intentMap = await loadCampaignIntentMap(prisma, workspaceId)

  const fromStr = dateFrom.toISOString().slice(0, 10)
  const toStr = dateTo.toISOString().slice(0, 10)

  const [current, prior, goalRows] = await Promise.all([
    computeMetaData(prisma, conn.id, adAccountId, intentMap, dateFrom, dateTo),
    computeMetaData(prisma, conn.id, adAccountId, intentMap, priorRange.from, priorRange.to),
    fetchGoalRowsMap(prisma, workspaceId, ['meta_roas'] as GoalMetricId[], dateTo),
  ])

  const goalEvals = buildGoalEvaluations(
    { meta_roas: current.summary.roas ?? undefined },
    goalRows
  )
  const goals: GoalContext[] = Object.entries(goalEvals).map(([key, ev]) => ({
    metricName: key,
    label: key === 'meta_roas' ? 'Meta ROAS' : key,
    goal: ev.goal,
    actual: ev.actual,
    variancePct: ev.variancePct,
    rag: ev.rag,
  }))

  return {
    page: 'meta-ads',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: current.summary,
    priorSummary: prior.summary,
    daily: current.daily,
    currency: 'INR',
    goals: goals.length > 0 ? goals : undefined,
    extra: {
      campaigns: current.campaigns,
      priorCampaigns: prior.campaigns,
      fromStr,
      toStr,
    },
  }
}
