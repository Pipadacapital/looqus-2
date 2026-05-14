/**
 * Ads calculator for AI context.
 * Combines Meta + Google Ads metrics.
 */
import type { PrismaClient } from '@prisma/client'
import type { AiAdsData, AiAdCampaign } from './types'

interface AdsWorkspace {
  meta_ads_connections: {
    id: string
    selected_ad_account_ids: string[] | null
    selected_ad_account_id: string | null
  } | null
  google_ads_connections: {
    id: string
    selected_customer_ids: string[] | null
    selected_customer_id: string | null
  } | null
}

export async function calcAds(
  prisma: PrismaClient,
  workspace: AdsWorkspace,
  fromDate: Date,
  toDate: Date,
  totalNetSales: number,
): Promise<AiAdsData> {
  const meta = workspace.meta_ads_connections
  const google = workspace.google_ads_connections

  const metaSelectedIds = meta?.selected_ad_account_ids?.length
    ? meta.selected_ad_account_ids
    : meta?.selected_ad_account_id ? [meta.selected_ad_account_id] : undefined

  const googleSelectedIds = google?.selected_customer_ids?.length
    ? google.selected_customer_ids
    : google?.selected_customer_id ? [google.selected_customer_id] : undefined

  // Fetch campaign-level data for Meta
  const metaCampaigns = meta?.id
    ? await prisma.meta_ads_daily_metrics.findMany({
        where: {
          connection_id: meta.id,
          date: { gte: fromDate, lte: toDate },
          ...(metaSelectedIds ? { ad_account_id: { in: metaSelectedIds } } : {}),
        },
        select: {
          campaign_id: true, campaign_name: true,
          spend: true, impressions: true, clicks: true, conversions: true,
        },
      })
    : []

  // Fetch campaign-level data for Google
  const googleCampaigns = google?.id
    ? await prisma.google_ads_daily_metrics.findMany({
        where: {
          connection_id: google.id,
          date: { gte: fromDate, lte: toDate },
          ...(googleSelectedIds ? { customer_id: { in: googleSelectedIds } } : {}),
        },
        select: {
          campaign_id: true, campaign_name: true,
          spend: true, impressions: true, clicks: true, conversions: true,
        },
      })
    : []

  // Aggregate by campaign
  const campaignMap = new Map<string, AiAdCampaign>()

  for (const r of metaCampaigns) {
    const key = `meta_${r.campaign_id}`
    const existing = campaignMap.get(key)
    if (existing) {
      existing.spend += Number(r.spend)
      existing.impressions += Number(r.impressions ?? 0)
      existing.clicks += Number(r.clicks ?? 0)
      existing.conversions += Number(r.conversions ?? 0)
    } else {
      campaignMap.set(key, {
        campaignId: r.campaign_id ?? '',
        campaignName: r.campaign_name ?? 'Unknown',
        platform: 'meta',
        spend: Number(r.spend),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        conversions: Number(r.conversions ?? 0),
        roas: null, cpc: null, ctr: null,
      })
    }
  }

  for (const r of googleCampaigns) {
    const key = `google_${r.campaign_id}`
    const existing = campaignMap.get(key)
    if (existing) {
      existing.spend += Number(r.spend)
      existing.impressions += Number(r.impressions ?? 0)
      existing.clicks += Number(r.clicks ?? 0)
      existing.conversions += Number(r.conversions ?? 0)
    } else {
      campaignMap.set(key, {
        campaignId: r.campaign_id ?? '',
        campaignName: r.campaign_name ?? 'Unknown',
        platform: 'google',
        spend: Number(r.spend),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        conversions: Number(r.conversions ?? 0),
        roas: null, cpc: null, ctr: null,
      })
    }
  }

  // Compute derived metrics
  for (const c of campaignMap.values()) {
    c.cpc = c.clicks > 0 ? c.spend / c.clicks : null
    c.ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : null
    // ROAS per campaign isn't directly available without attribution; skip for now
  }

  const allCampaigns = Array.from(campaignMap.values())
  const topCampaigns = allCampaigns
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10)

  const metaSpend = allCampaigns.filter(c => c.platform === 'meta').reduce((s, c) => s + c.spend, 0)
  const googleSpend = allCampaigns.filter(c => c.platform === 'google').reduce((s, c) => s + c.spend, 0)
  const totalSpend = metaSpend + googleSpend

  return {
    summary: {
      metaSpend,
      googleSpend,
      totalSpend,
      blendedRoas: totalSpend > 0 ? Math.round((totalNetSales / totalSpend) * 100) / 100 : null,
      acos: totalNetSales > 0 ? Math.round((totalSpend / totalNetSales) * 10000) / 100 : null,
      topCampaigns,
    },
    currency: 'INR',
  }
}
