import type { PrismaClient } from '@prisma/client'
import type { Anomaly } from '@/lib/insights/types'

type WorkspaceForAnomalies = {
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

const SPEND_SPIKE_MULTIPLIER = 2
const SPEND_DROP_MULTIPLIER = 0.5
const ROAS_DROP_THRESHOLD = 0.5

/** Detect anomalies from daily/campaign metrics. No RAG — rule-based. */
export async function getAnomalies(
  prisma: PrismaClient,
  workspace: WorkspaceForAnomalies,
  since: Date,
  days: number
): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = []

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
    const dailySpend = new Map<string, number>()
    for (const m of metaMetrics) {
      const d = m.date.toISOString().slice(0, 10)
      dailySpend.set(d, (dailySpend.get(d) ?? 0) + Number(m.spend))
    }
    const totalSpend = Array.from(dailySpend.values()).reduce((a, b) => a + b, 0)
    const avgDailySpend = dailySpend.size > 0 ? totalSpend / dailySpend.size : 0
    if (avgDailySpend > 0) {
      for (const [date, spend] of dailySpend) {
        if (spend >= SPEND_SPIKE_MULTIPLIER * avgDailySpend) {
          anomalies.push({
            type: 'spend_spike',
            source: 'meta',
            description: `Spend ${(spend / avgDailySpend).toFixed(1)}x above daily average`,
            date,
            value: Math.round(spend * 100) / 100,
            priorValue: Math.round(avgDailySpend * 100) / 100,
          })
        } else if (spend <= SPEND_DROP_MULTIPLIER * avgDailySpend && spend > 0) {
          anomalies.push({
            type: 'spend_drop',
            source: 'meta',
            description: `Spend well below daily average`,
            date,
            value: Math.round(spend * 100) / 100,
            priorValue: Math.round(avgDailySpend * 100) / 100,
          })
        }
      }
    }
    const campaignTotals = new Map<
      string,
      { name: string; spend: number; revenue: number }
    >()
    for (const m of metaMetrics) {
      const spend = Number(m.spend)
      const revenue = Number(m.revenue)
      const key = m.campaign_id
      const ex = campaignTotals.get(key)
      if (ex) {
        ex.spend += spend
        ex.revenue += revenue
      } else {
        campaignTotals.set(key, { name: m.campaign_name, spend, revenue })
      }
    }
    const accountSpend = Array.from(campaignTotals.values()).reduce((a, c) => a + c.spend, 0)
    const accountRevenue = Array.from(campaignTotals.values()).reduce((a, c) => a + c.revenue, 0)
    const accountRoas = accountSpend > 0 ? accountRevenue / accountSpend : 0
    if (accountRoas > 0) {
      for (const [cid, c] of campaignTotals) {
        const roas = c.spend > 0 ? c.revenue / c.spend : 0
        if (roas > 0 && roas <= ROAS_DROP_THRESHOLD * accountRoas && c.spend >= 100) {
          anomalies.push({
            type: 'roas_drop',
            source: 'meta',
            description: `ROAS ${roas.toFixed(2)}x vs account ${accountRoas.toFixed(2)}x`,
            campaign: c.name || cid,
            value: Math.round(roas * 100) / 100,
            priorValue: Math.round(accountRoas * 100) / 100,
          })
        }
      }
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
    const dailySpend = new Map<string, number>()
    for (const m of googleMetrics) {
      const d = m.date.toISOString().slice(0, 10)
      dailySpend.set(d, (dailySpend.get(d) ?? 0) + Number(m.spend))
    }
    const totalSpend = Array.from(dailySpend.values()).reduce((a, b) => a + b, 0)
    const avgDailySpend = dailySpend.size > 0 ? totalSpend / dailySpend.size : 0
    if (avgDailySpend > 0) {
      for (const [date, spend] of dailySpend) {
        if (spend >= SPEND_SPIKE_MULTIPLIER * avgDailySpend) {
          anomalies.push({
            type: 'spend_spike',
            source: 'google',
            description: `Spend ${(spend / avgDailySpend).toFixed(1)}x above daily average`,
            date,
            value: Math.round(spend * 100) / 100,
            priorValue: Math.round(avgDailySpend * 100) / 100,
          })
        }
      }
    }
    const campaignTotals = new Map<
      string,
      { name: string; spend: number; conversionValue: number }
    >()
    for (const m of googleMetrics) {
      const spend = Number(m.spend)
      const cv = Number(m.conversion_value)
      const key = m.campaign_id
      const ex = campaignTotals.get(key)
      if (ex) {
        ex.spend += spend
        ex.conversionValue += cv
      } else {
        campaignTotals.set(key, { name: m.campaign_name, spend, conversionValue: cv })
      }
    }
    const accountSpend = Array.from(campaignTotals.values()).reduce((a, c) => a + c.spend, 0)
    const accountConvVal = Array.from(campaignTotals.values()).reduce(
      (a, c) => a + c.conversionValue,
      0
    )
    const accountRoas = accountSpend > 0 ? accountConvVal / accountSpend : 0
    if (accountRoas > 0) {
      for (const [cid, c] of campaignTotals) {
        const roas = c.spend > 0 ? c.conversionValue / c.spend : 0
        if (roas > 0 && roas <= ROAS_DROP_THRESHOLD * accountRoas && c.spend >= 100) {
          anomalies.push({
            type: 'roas_drop',
            source: 'google',
            description: `ROAS ${roas.toFixed(2)}x vs account ${accountRoas.toFixed(2)}x`,
            campaign: c.name || cid,
            value: Math.round(roas * 100) / 100,
            priorValue: Math.round(accountRoas * 100) / 100,
          })
        }
      }
    }
  }

  return anomalies.slice(0, 15)
}
