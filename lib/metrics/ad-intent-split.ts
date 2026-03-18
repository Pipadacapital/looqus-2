/**
 * Aggregate ad spend/revenue by campaign intent for a single platform (Meta or Google).
 * Used for ads pages + reconciliation (four intents sum to total).
 */

import type { AdPlatform, CampaignIntent } from './types'
import type { ClassificationKey } from './campaign-classification'
import { resolveCampaignIntent } from './campaign-classification'

type IntentClassificationMap = Map<ClassificationKey, CampaignIntent>

export type IntentBucket = {
  spend: number
  revenue: number
  /** Distinct campaign ids with any spend or revenue in bucket */
  campaignIds: Set<string>
}

const INTENTS: CampaignIntent[] = [
  'acquisition',
  'non_acquisition',
  'brand',
  'unclassified',
]

export function emptyIntentBuckets(): Record<CampaignIntent, IntentBucket> {
  const mk = (): IntentBucket => ({
    spend: 0,
    revenue: 0,
    campaignIds: new Set(),
  })
  return {
    acquisition: mk(),
    non_acquisition: mk(),
    brand: mk(),
    unclassified: mk(),
  }
}

export function addMetricToIntentBuckets(
  buckets: Record<CampaignIntent, IntentBucket>,
  intentMap: IntentClassificationMap,
  platform: AdPlatform,
  campaignId: string,
  spend: number,
  revenue: number
): CampaignIntent {
  const intent = resolveCampaignIntent(intentMap, platform, campaignId)
  const b = buckets[intent]
  b.spend += spend
  b.revenue += revenue
  if (spend !== 0 || revenue !== 0) b.campaignIds.add(campaignId)
  return intent
}

export type IntentSplitPayload = {
  byIntent: Record<
    CampaignIntent,
    { spend: number; revenue: number; campaignCount: number }
  >
  /** Sum of the four intent spends — should equal totalSpend within epsilon */
  sumSpendByIntent: number
  totalSpend: number
  totalRevenue: number
  spendReconciles: boolean
  revenueReconciles: boolean
  spendDelta: number
  revenueDelta: number
  /** Platform-attributed revenue / spend for acquisition-tagged campaigns */
  acquisitionRoas: number | null
  /** Revenue / spend for non_acquisition + brand + unclassified (pooled) */
  nonAcquisitionPoolRoas: number | null
}

const EPS = 0.02

/**
 * Build API-safe split + ROAS helpers. totalSpend/totalRevenue are period totals from raw rows.
 */
export function buildIntentSplitPayload(
  buckets: Record<CampaignIntent, IntentBucket>,
  totalSpend: number,
  totalRevenue: number
): IntentSplitPayload {
  const byIntent = {} as IntentSplitPayload['byIntent']
  let sumSpendByIntent = 0
  let sumRevenueByIntent = 0
  for (const k of INTENTS) {
    const b = buckets[k]
    byIntent[k] = {
      spend: b.spend,
      revenue: b.revenue,
      campaignCount: b.campaignIds.size,
    }
    sumSpendByIntent += b.spend
    sumRevenueByIntent += b.revenue
  }
  const spendDelta = Math.round((sumSpendByIntent - totalSpend) * 100) / 100
  const revenueDelta = Math.round((sumRevenueByIntent - totalRevenue) * 100) / 100
  const spendReconciles = Math.abs(sumSpendByIntent - totalSpend) <= EPS
  const revenueReconciles = Math.abs(sumRevenueByIntent - totalRevenue) <= EPS
  const acq = buckets.acquisition
  const acquisitionRoas =
    acq.spend > 0 ? Math.round((acq.revenue / acq.spend) * 100) / 100 : null
  const nonAcqSpend =
    buckets.non_acquisition.spend + buckets.brand.spend + buckets.unclassified.spend
  const nonAcqRev =
    buckets.non_acquisition.revenue + buckets.brand.revenue + buckets.unclassified.revenue
  const nonAcquisitionPoolRoas =
    nonAcqSpend > 0 ? Math.round((nonAcqRev / nonAcqSpend) * 100) / 100 : null

  return {
    byIntent,
    sumSpendByIntent,
    totalSpend,
    totalRevenue,
    spendReconciles,
    revenueReconciles,
    spendDelta,
    revenueDelta,
    acquisitionRoas,
    nonAcquisitionPoolRoas,
  }
}

export function matchesIntentFilter(
  intent: CampaignIntent,
  filter: string | null
): boolean {
  if (!filter || filter === 'all') return true
  if (
    filter === 'acquisition' ||
    filter === 'non_acquisition' ||
    filter === 'brand' ||
    filter === 'unclassified'
  ) {
    return intent === filter
  }
  return true
}
