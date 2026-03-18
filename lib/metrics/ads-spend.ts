import type { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { getEffectiveDailyAggregates } from '@/lib/effective-daily'
import {
  getOrderInclusionWhere,
  hasNoOrderFilters,
  type OrderFilterSettings,
} from '@/lib/order-filters'
import type { AdPlatform } from './types'
import { loadCampaignIntentMap, resolveCampaignIntent } from './campaign-classification'

export type WorkspaceAdsConnections = {
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

export type AdSpendMapsWithClassification = {
  byDate: Map<string, number>
  metaByDate: Map<string, number>
  googleByDate: Map<string, number>
  /** Acquisition-classified spend per day (for range-filtered aMER). */
  acquisitionByDate: Map<string, number>
  totalAdSpend: number
  acquisitionAdSpend: number
  unclassifiedAdSpend: number
  /** non_acquisition + brand */
  otherClassifiedAdSpend: number
}

function metaAccountIds(meta: WorkspaceAdsConnections['meta_ads_connections']): string[] | undefined {
  if (!meta) return undefined
  if (meta.selected_ad_account_ids?.length) return meta.selected_ad_account_ids
  if (meta.selected_ad_account_id) return [meta.selected_ad_account_id]
  return undefined
}

function googleCustomerIds(google: WorkspaceAdsConnections['google_ads_connections']): string[] | undefined {
  if (!google) return undefined
  if (google.selected_customer_ids?.length) return google.selected_customer_ids
  if (google.selected_customer_id) return [google.selected_customer_id]
  return undefined
}

/**
 * Daily ad spend (Meta + Google) plus period split by campaign intent.
 * Totals match prior groupBy-by-date sums; classification only affects acquisition / unclassified / other buckets.
 */
export async function fetchAdSpendMapsWithClassification(
  prisma: PrismaClient,
  workspaceId: string,
  workspace: WorkspaceAdsConnections,
  fromDate: Date,
  toDate: Date
): Promise<AdSpendMapsWithClassification> {
  const byDate = new Map<string, number>()
  const metaByDate = new Map<string, number>()
  const googleByDate = new Map<string, number>()
  const acquisitionByDate = new Map<string, number>()
  let acquisitionAdSpend = 0
  let unclassifiedAdSpend = 0
  let otherClassifiedAdSpend = 0

  const intentMap = await loadCampaignIntentMap(prisma, workspaceId)
  const meta = workspace.meta_ads_connections
  const google = workspace.google_ads_connections
  const metaIds = metaAccountIds(meta)
  const gIds = googleCustomerIds(google)

  const addMetaRow = (dateStr: string, spend: number, campaignId: string) => {
    const s = spend
    metaByDate.set(dateStr, (metaByDate.get(dateStr) ?? 0) + s)
    byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + s)
    const intent = resolveCampaignIntent(intentMap, 'meta', campaignId)
    if (intent === 'acquisition') {
      acquisitionAdSpend += s
      acquisitionByDate.set(dateStr, (acquisitionByDate.get(dateStr) ?? 0) + s)
    } else if (intent === 'unclassified') unclassifiedAdSpend += s
    else otherClassifiedAdSpend += s
  }

  const addGoogleRow = (dateStr: string, spend: number, campaignId: string) => {
    const s = spend
    googleByDate.set(dateStr, (googleByDate.get(dateStr) ?? 0) + s)
    byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + s)
    const intent = resolveCampaignIntent(intentMap, 'google', campaignId)
    if (intent === 'acquisition') {
      acquisitionAdSpend += s
      acquisitionByDate.set(dateStr, (acquisitionByDate.get(dateStr) ?? 0) + s)
    } else if (intent === 'unclassified') unclassifiedAdSpend += s
    else otherClassifiedAdSpend += s
  }

  if (meta?.id) {
    const where: Prisma.meta_ads_daily_metricsWhereInput = {
      connection_id: meta.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (metaIds?.length) where.ad_account_id = { in: metaIds }
    const rows = await prisma.meta_ads_daily_metrics.findMany({
      where,
      select: { date: true, spend: true, campaign_id: true },
    })
    for (const r of rows) {
      addMetaRow(r.date.toISOString().slice(0, 10), Number(r.spend ?? 0), r.campaign_id)
    }
  }

  if (google?.id) {
    const where: Prisma.google_ads_daily_metricsWhereInput = {
      connection_id: google.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (gIds?.length) where.customer_id = { in: gIds }
    const rows = await prisma.google_ads_daily_metrics.findMany({
      where,
      select: { date: true, spend: true, campaign_id: true },
    })
    for (const r of rows) {
      addGoogleRow(r.date.toISOString().slice(0, 10), Number(r.spend ?? 0), r.campaign_id)
    }
  }

  const totalAdSpend = [...byDate.values()].reduce((a, b) => a + b, 0)
  return {
    byDate,
    metaByDate,
    googleByDate,
    acquisitionByDate,
    totalAdSpend,
    acquisitionAdSpend,
    unclassifiedAdSpend,
    otherClassifiedAdSpend,
  }
}

/** Sum daily map values for yyyy-MM-dd keys within [fromStr, toStr] inclusive. */
export function sumDailyMapInRange(
  byDate: Map<string, number>,
  fromStr: string,
  toStr: string
): number {
  let t = 0
  for (const [d, v] of byDate) {
    if (d >= fromStr && d <= toStr) t += v
  }
  return t
}

/**
 * Store net revenue for MER numerator.
 * No order filters: sum analytics netSales + gap days from raw orders (same basis as dashboard summary
 * when analytics exists; gap fill is unfiltered store orders).
 * With filters: only included orders + effective-daily refund share — MER then aligns with filtered analytics,
 * not with unfiltered Dashboard totals.
 */
export async function fetchStoreNetRevenueForPeriod(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  orderFilterSettings: OrderFilterSettings
): Promise<number> {
  const orderInclusionWhere = getOrderInclusionWhere(orderFilterSettings)

  if (hasNoOrderFilters(orderFilterSettings)) {
    const rows = await prisma.shopifyAnalyticsDaily.findMany({
      where: { connectionId, date: { gte: fromDate, lte: toDate } },
      select: { date: true, netSales: true },
    })
    const withAnalytics = new Set(rows.map((r) => r.date.toISOString().slice(0, 10)))
    let sum = rows.reduce((s, r) => s + Number(r.netSales), 0)
    const gapOrders = await prisma.shopifyOrder.findMany({
      where: {
        connectionId,
        processedAt: { gte: fromDate, lte: toDate },
        cancelledAt: null,
      },
      select: { processedAt: true, totalPrice: true, totalTax: true },
    })
    const byDate = new Map<string, number>()
    for (const o of gapOrders) {
      const ds = o.processedAt.toISOString().slice(0, 10)
      byDate.set(
        ds,
        (byDate.get(ds) ?? 0) + Number(o.totalPrice) - Number(o.totalTax ?? 0)
      )
    }
    for (const [ds, v] of byDate) {
      if (!withAnalytics.has(ds)) sum += v
    }
    return sum
  }

  const effective = await getEffectiveDailyAggregates(
    prisma,
    connectionId,
    fromDate,
    toDate,
    orderInclusionWhere
  )
  const orders = await prisma.shopifyOrder.findMany({
    where: {
      connectionId,
      processedAt: { gte: fromDate, lte: toDate },
      cancelledAt: null,
      ...orderInclusionWhere,
    },
    select: { processedAt: true, totalPrice: true, totalTax: true },
  })
  let total = 0
  for (const o of orders) {
    const ds = o.processedAt.toISOString().slice(0, 10)
    const day = effective.get(ds)
    const tp = Number(o.totalPrice)
    const tax = Number(o.totalTax ?? 0)
    const gross = day?.grossSales ?? 0
    const ret = day?.totalReturns ?? 0
    const share = gross > 0 ? (tp / gross) * ret : 0
    total += tp - tax - share
  }
  return total
}

export type CampaignSpendRow = {
  platform: AdPlatform
  campaignId: string
  campaignName: string
  spend: number
}

/**
 * Distinct campaigns with spend in range (for classification UI).
 */
export async function fetchCampaignsWithSpendInRange(
  prisma: PrismaClient,
  workspace: WorkspaceAdsConnections,
  fromDate: Date,
  toDate: Date
): Promise<CampaignSpendRow[]> {
  const meta = workspace.meta_ads_connections
  const google = workspace.google_ads_connections
  const metaIds = metaAccountIds(meta)
  const gIds = googleCustomerIds(google)
  const acc = new Map<string, { platform: AdPlatform; campaignId: string; campaignName: string; spend: number }>()

  const key = (p: AdPlatform, id: string) => `${p}:${id}`

  if (meta?.id) {
    const where: Prisma.meta_ads_daily_metricsWhereInput = {
      connection_id: meta.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (metaIds?.length) where.ad_account_id = { in: metaIds }
    const rows = await prisma.meta_ads_daily_metrics.findMany({
      where,
      select: { campaign_id: true, campaign_name: true, spend: true },
    })
    for (const r of rows) {
      const k = key('meta', r.campaign_id)
      const ex = acc.get(k)
      const sp = Number(r.spend ?? 0)
      if (ex) ex.spend += sp
      else acc.set(k, { platform: 'meta', campaignId: r.campaign_id, campaignName: r.campaign_name ?? '', spend: sp })
    }
  }
  if (google?.id) {
    const where: Prisma.google_ads_daily_metricsWhereInput = {
      connection_id: google.id,
      date: { gte: fromDate, lte: toDate },
    }
    if (gIds?.length) where.customer_id = { in: gIds }
    const rows = await prisma.google_ads_daily_metrics.findMany({
      where,
      select: { campaign_id: true, campaign_name: true, spend: true },
    })
    for (const r of rows) {
      const k = key('google', r.campaign_id)
      const ex = acc.get(k)
      const sp = Number(r.spend ?? 0)
      if (ex) ex.spend += sp
      else acc.set(k, { platform: 'google', campaignId: r.campaign_id, campaignName: r.campaign_name ?? '', spend: sp })
    }
  }

  return [...acc.values()]
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.spend - a.spend)
}
