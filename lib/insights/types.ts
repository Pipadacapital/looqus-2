/**
 * Unified metrics snapshot passed to the LLM for analysis.
 * LLM does NOT execute — it only analyzes these numbers.
 */
export type AggregatedMetrics = {
  period: { from: string; to: string; days: number }
  meta?: {
    spend: number
    revenue: number
    roas: number
    impressions: number
    clicks: number
    conversions: number
    ctr: number
    cpc: number
    cpm: number
    topCampaigns: { name: string; spend: number; revenue: number; roas: number }[]
  }
  google?: {
    spend: number
    conversionValue: number
    roas: number
    impressions: number
    clicks: number
    conversions: number
    ctr: number
    cpc: number
    cpm: number
    topCampaigns: { name: string; spend: number; conversionValue: number; roas: number }[]
  }
}

/**
 * Structured insight output from the LLM.
 * Types: performance_alert | roas_drop | high_returns | margin_risk | ad_efficiency
 */
export type InsightType =
  | 'performance_alert'
  | 'roas_drop'
  | 'high_returns'
  | 'margin_risk'
  | 'ad_efficiency'

export type StructuredInsight = {
  insight_type: InsightType
  title: string
  reason: string
  recommendation: string
  confidence: number
}

export type StructuredInsightResponse = {
  insights: StructuredInsight[]
}

/** Trend: current period vs prior period (% change). */
export type TrendSummary = {
  meta?: {
    spendPctChange: number
    revenuePctChange: number
    roasPctChange: number
  }
  google?: {
    spendPctChange: number
    conversionValuePctChange: number
    roasPctChange: number
  }
}

/** Anomaly: spike, drop, or outlier. */
export type Anomaly = {
  type: 'spend_spike' | 'spend_drop' | 'roas_drop' | 'revenue_drop'
  source: 'meta' | 'google'
  description: string
  date?: string
  campaign?: string
  value?: number
  priorValue?: number
}
