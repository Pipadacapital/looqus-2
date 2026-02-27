import type { PrismaClient } from '@prisma/client'
import type { AggregatedMetrics } from '@/lib/insights/types'

type WorkspaceForAggregation = {
  id: string
  meta_ads_connections: {
    id: string
    selected_ad_account_id: string | null
    ad_account_ids: string[] | null
  } | null
  google_ads_connections: {
    id: string
    selected_customer_id: string | null
    customer_ids: string[] | null
  } | null
}

export async function getAggregatedMetrics(
  prisma: PrismaClient,
  workspace: WorkspaceForAggregation,
  since: Date,
  days: number
): Promise<AggregatedMetrics> {
  const to = new Date()
  const period = {
    from: since.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    days,
  }
  const aggregated: AggregatedMetrics = { period }

  const metaConn = workspace.meta_ads_connections
  const metaAdAccountId =
    metaConn?.selected_ad_account_id ??
    (metaConn?.ad_account_ids?.length ? metaConn.ad_account_ids[0] : null)
  if (metaConn && metaAdAccountId) {
    const metaMetrics = await prisma.meta_ads_daily_metrics.findMany({
      where: {
        connection_id: metaConn.id,
        ad_account_id: metaAdAccountId,
        date: { gte: since },
      },
      orderBy: { date: 'asc' },
    })
    let metaSpend = 0,
      metaRevenue = 0,
      metaImpressions = 0,
      metaClicks = 0,
      metaConversions = 0
    const metaByCampaign = new Map<string, { name: string; spend: number; revenue: number }>()
    for (const m of metaMetrics) {
      const spend = Number(m.spend)
      const revenue = Number(m.revenue)
      metaSpend += spend
      metaRevenue += revenue
      metaImpressions += m.impressions
      metaClicks += m.clicks
      metaConversions += m.conversions
      const key = m.campaign_id
      const ex = metaByCampaign.get(key)
      if (ex) {
        ex.spend += spend
        ex.revenue += revenue
      } else {
        metaByCampaign.set(key, { name: m.campaign_name, spend, revenue })
      }
    }
    const metaRoas = metaSpend > 0 ? metaRevenue / metaSpend : 0
    const metaCtr = metaImpressions > 0 ? (metaClicks / metaImpressions) * 100 : 0
    const metaCpc = metaClicks > 0 ? metaSpend / metaClicks : 0
    const metaCpm = metaImpressions > 0 ? (metaSpend / metaImpressions) * 1000 : 0
    aggregated.meta = {
      spend: metaSpend,
      revenue: metaRevenue,
      roas: Math.round(metaRoas * 100) / 100,
      impressions: metaImpressions,
      clicks: metaClicks,
      conversions: metaConversions,
      ctr: Math.round(metaCtr * 100) / 100,
      cpc: Math.round(metaCpc * 100) / 100,
      cpm: Math.round(metaCpm * 100) / 100,
      topCampaigns: Array.from(metaByCampaign.values())
        .map((c) => ({
          name: c.name,
          spend: c.spend,
          revenue: c.revenue,
          roas: c.spend > 0 ? Math.round((c.revenue / c.spend) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 5),
    }
  }

  const googleConn = workspace.google_ads_connections
  const googleCustomerId =
    googleConn?.selected_customer_id ??
    (googleConn?.customer_ids?.length ? googleConn.customer_ids[0] : null)
  if (googleConn && googleCustomerId) {
    const googleMetrics = await prisma.google_ads_daily_metrics.findMany({
      where: {
        connection_id: googleConn.id,
        customer_id: googleCustomerId,
        date: { gte: since },
      },
      orderBy: { date: 'asc' },
    })
    let gSpend = 0,
      gConvVal = 0,
      gImpressions = 0,
      gClicks = 0,
      gConversions = 0
    const gByCampaign = new Map<
      string,
      { name: string; spend: number; conversionValue: number }
    >()
    for (const m of googleMetrics) {
      const spend = Number(m.spend)
      const cv = Number(m.conversion_value)
      gSpend += spend
      gConvVal += cv
      gImpressions += m.impressions
      gClicks += m.clicks
      gConversions += Number(m.conversions)
      const key = m.campaign_id
      const ex = gByCampaign.get(key)
      if (ex) {
        ex.spend += spend
        ex.conversionValue += cv
      } else {
        gByCampaign.set(key, { name: m.campaign_name, spend, conversionValue: cv })
      }
    }
    const gRoas = gSpend > 0 ? gConvVal / gSpend : 0
    const gCtr = gImpressions > 0 ? (gClicks / gImpressions) * 100 : 0
    const gCpc = gClicks > 0 ? gSpend / gClicks : 0
    const gCpm = gImpressions > 0 ? (gSpend / gImpressions) * 1000 : 0
    aggregated.google = {
      spend: gSpend,
      conversionValue: gConvVal,
      roas: Math.round(gRoas * 100) / 100,
      impressions: gImpressions,
      clicks: gClicks,
      conversions: gConversions,
      ctr: Math.round(gCtr * 100) / 100,
      cpc: Math.round(gCpc * 100) / 100,
      cpm: Math.round(gCpm * 100) / 100,
      topCampaigns: Array.from(gByCampaign.values())
        .map((c) => ({
          name: c.name,
          spend: c.spend,
          conversionValue: c.conversionValue,
          roas: c.spend > 0 ? Math.round((c.conversionValue / c.spend) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 5),
    }
  }

  return aggregated
}
