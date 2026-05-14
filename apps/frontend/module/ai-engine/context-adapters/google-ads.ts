import type { PrismaClient } from '@prisma/client'
import { loadCampaignIntentMap, resolveCampaignIntent, type ClassificationKey } from '@/lib/metrics/campaign-classification'
import type { CampaignIntent } from '@/lib/metrics/types'
import { googleMergedFunnelSnapshot } from '@/lib/metrics/paid-media-funnel'
import {
  addFunnelDailyRow,
  emptyGoogleStagedCounts,
  hasStagedFunnelData,
} from '@/lib/metrics/google-funnel-aggregate'
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
  conversionValue: number
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
  hasStagedFunnel: boolean
}

async function computeGoogleData(
  prisma: PrismaClient,
  connectionId: string,
  customerId: string,
  intentMap: Map<ClassificationKey, CampaignIntent>,
  fromDate: Date,
  toDate: Date
): Promise<{
  summary: Record<string, number | null>
  daily: CompressedDailyRow[]
  campaigns: CampaignSummary[]
}> {
  const [metrics, funnelDaily] = await Promise.all([
    prisma.google_ads_daily_metrics.findMany({
      where: {
        connection_id: connectionId,
        customer_id: customerId,
        date: { gte: fromDate, lte: toDate },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.google_ads_funnel_daily.findMany({
      where: {
        connection_id: connectionId,
        customer_id: customerId,
        date: { gte: fromDate, lte: toDate },
      },
    }),
  ])

  if (metrics.length === 0) {
    return { summary: {}, daily: [], campaigns: [] }
  }

  // Build staged funnel maps
  const stagedByCampaign = new Map<string, ReturnType<typeof emptyGoogleStagedCounts>>()
  const totalsStaged = emptyGoogleStagedCounts()

  for (const fr of funnelDaily) {
    addFunnelDailyRow(totalsStaged, fr)
    let sc = stagedByCampaign.get(fr.campaign_id)
    if (!sc) {
      sc = emptyGoogleStagedCounts()
      stagedByCampaign.set(fr.campaign_id, sc)
    }
    addFunnelDailyRow(sc, fr)
  }

  const hasTotalStaged = hasStagedFunnelData(totalsStaged)

  // Aggregate totals + by campaign + daily
  type Agg = { impressions: number; clicks: number; spend: number; conversions: number; conversionValue: number }
  const totals: Agg = { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0 }
  const acqTotals: Agg = { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0 }
  const retTotals: Agg = { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0 }

  const dailyMap = new Map<string, Agg>()
  const campaignMap = new Map<string, { campaignId: string; campaignName: string; intent: string } & Agg>()

  for (const m of metrics) {
    const spend = Number(m.spend)
    const conversions = Number(m.conversions)
    const conversionValue = Number(m.conversion_value)
    const intent = resolveCampaignIntent(intentMap, 'google', m.campaign_id)

    totals.impressions += m.impressions
    totals.clicks += m.clicks
    totals.spend += spend
    totals.conversions += conversions
    totals.conversionValue += conversionValue

    if (intent === 'acquisition') {
      acqTotals.spend += spend
      acqTotals.conversionValue += conversionValue
      acqTotals.conversions += conversions
      acqTotals.impressions += m.impressions
      acqTotals.clicks += m.clicks
    } else {
      retTotals.spend += spend
      retTotals.conversionValue += conversionValue
      retTotals.conversions += conversions
      retTotals.impressions += m.impressions
      retTotals.clicks += m.clicks
    }

    const dateStr = m.date.toISOString().slice(0, 10)
    const dayEntry = dailyMap.get(dateStr)
    if (dayEntry) {
      dayEntry.impressions += m.impressions
      dayEntry.clicks += m.clicks
      dayEntry.spend += spend
      dayEntry.conversions += conversions
      dayEntry.conversionValue += conversionValue
    } else {
      dailyMap.set(dateStr, { impressions: m.impressions, clicks: m.clicks, spend, conversions, conversionValue })
    }

    const cEntry = campaignMap.get(m.campaign_id)
    if (cEntry) {
      cEntry.impressions += m.impressions
      cEntry.clicks += m.clicks
      cEntry.spend += spend
      cEntry.conversions += conversions
      cEntry.conversionValue += conversionValue
    } else {
      campaignMap.set(m.campaign_id, {
        campaignId: m.campaign_id,
        campaignName: m.campaign_name,
        intent,
        impressions: m.impressions,
        clicks: m.clicks,
        spend,
        conversions,
        conversionValue,
      })
    }
  }

  const totalSnap = googleMergedFunnelSnapshot(
    { impressions: totals.impressions, clicks: totals.clicks, spend: totals.spend, conversions: totals.conversions, conversionValue: totals.conversionValue },
    hasTotalStaged ? totalsStaged : null
  )
  const acqRoas = acqTotals.spend > 0 ? Math.round((acqTotals.conversionValue / acqTotals.spend) * 100) / 100 : 0
  const retRoas = retTotals.spend > 0 ? Math.round((retTotals.conversionValue / retTotals.spend) * 100) / 100 : 0

  // Top 6 campaigns by spend
  const campaigns: CampaignSummary[] = Array.from(campaignMap.values())
    .map(c => {
      const staged = stagedByCampaign.get(c.campaignId)
      const snap = googleMergedFunnelSnapshot(
        { impressions: c.impressions, clicks: c.clicks, spend: c.spend, conversions: c.conversions, conversionValue: c.conversionValue },
        staged && hasStagedFunnelData(staged) ? staged : null
      )
      return {
        name: c.campaignName.length > 35 ? c.campaignName.slice(0, 35) + '…' : c.campaignName,
        intent: c.intent,
        spend: Math.round(snap.spend),
        conversionValue: Math.round(snap.attributedRevenue),
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
        hasStagedFunnel: snap.coverage === 'google_full',
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
      conversionValue: Math.round(d.conversionValue),
      roas: d.spend > 0 ? Math.round((d.conversionValue / d.spend) * 100) / 100 : 0,
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.conversions,
    }))

  const summary: Record<string, number | null> = {
    totalSpend: Math.round(totals.spend),
    totalConversionValue: Math.round(totals.conversionValue),
    totalImpressions: totals.impressions,
    totalClicks: totals.clicks,
    totalConversions: totals.conversions,
    roas: totalSnap.roas,
    ctr: totalSnap.ctrPct,
    cpc: totals.clicks > 0 ? Math.round(totals.spend / totals.clicks) : 0,
    overallCvr: totalSnap.overallCvrPct,
    // Funnel (only populated if google_full)
    addToCart: totalSnap.coverage === 'google_full' ? (totalSnap.addToCart ?? null) : null,
    checkoutInitiated: totalSnap.coverage === 'google_full' ? (totalSnap.checkoutInitiated ?? null) : null,
    atcRatePct: totalSnap.atcRatePct,
    checkoutPerAtcPct: totalSnap.checkoutPerAtcPct,
    purchasePerCheckoutPct: totalSnap.purchasePerCheckoutPct,
    costPerAtc: totalSnap.costPerAtc,
    costPerPurchase: totalSnap.costPerPurchase,
    // Intent split
    acqSpend: Math.round(acqTotals.spend),
    acqConversionValue: Math.round(acqTotals.conversionValue),
    acqRoas,
    acqSpendPct: totals.spend > 0
      ? Math.round((acqTotals.spend / totals.spend) * 10000) / 100
      : 0,
    retSpend: Math.round(retTotals.spend),
    retConversionValue: Math.round(retTotals.conversionValue),
    retRoas,
    hasStagedFunnel: hasTotalStaged ? 1 : 0,
  }

  return { summary, daily, campaigns }
}

export async function buildGoogleAdsContext(
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
      google_ads_connections: {
        where: { status: 'CONNECTED' },
        select: { id: true, selected_customer_id: true, customer_ids: true },
      },
    },
  })

  const conn = workspace.google_ads_connections
  const empty: PageContext = {
    page: 'google-ads',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: {},
    priorSummary: {},
    daily: [],
    currency: 'INR',
  }

  if (!conn) return empty

  const customerId = conn.selected_customer_id ?? conn.customer_ids?.[0] ?? null
  if (!customerId) return empty

  const intentMap = await loadCampaignIntentMap(prisma, workspaceId)

  const [current, prior, goalRows] = await Promise.all([
    computeGoogleData(prisma, conn.id, customerId, intentMap, dateFrom, dateTo),
    computeGoogleData(prisma, conn.id, customerId, intentMap, priorRange.from, priorRange.to),
    fetchGoalRowsMap(prisma, workspaceId, ['google_roas'] as GoalMetricId[], dateTo),
  ])

  const goalEvals = buildGoalEvaluations(
    { google_roas: current.summary.roas ?? undefined },
    goalRows
  )
  const goals: GoalContext[] = Object.entries(goalEvals).map(([key, ev]) => ({
    metricName: key,
    label: key === 'google_roas' ? 'Google ROAS' : key,
    goal: ev.goal,
    actual: ev.actual,
    variancePct: ev.variancePct,
    rag: ev.rag,
  }))

  return {
    page: 'google-ads',
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
      hasStagedFunnel: (current.summary.hasStagedFunnel ?? 0) > 0,
    },
  }
}
