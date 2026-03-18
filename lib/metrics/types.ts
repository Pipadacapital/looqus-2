import type { OrderFilterSettings } from '@/lib/order-filters'
import type { CogsSettings } from '@/lib/cogs/resolve'

/** Workspace-scoped inputs shared across metrics consumers. */
export type MetricsWorkspaceContext = {
  workspaceId: string
  connectionId: string
  storeCurrency: string
  orderFilterSettings: OrderFilterSettings
  cogsSettings: CogsSettings | null
  metaAdsConnectionId: string | null
  metaAdAccountIds: string[] | null
  googleAdsConnectionId: string | null
  googleCustomerIds: string[] | null
}

export type CampaignIntent = 'acquisition' | 'non_acquisition' | 'brand' | 'unclassified'

export type AdPlatform = 'meta' | 'google'

/** Persisted or resolved campaign classification row. */
export type WorkspaceCampaignClassification = {
  workspaceId: string
  platform: AdPlatform
  campaignId: string
  intent: CampaignIntent
  campaignName: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Store marketing efficiency for a period.
 * MER = store net revenue / total ad spend (same ratio as blended ROAS in this app).
 * aMER = new-customer net revenue / acquisition-classified ad spend only.
 */
export type MarketingEfficiencySnapshot = {
  totalAdSpend: number
  storeNetRevenue: number
  mer: number | null
  newCustomerRevenue: number
  acquisitionAdSpend: number
  aMer: number | null
  acos: number | null
}
