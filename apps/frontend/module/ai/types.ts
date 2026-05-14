/**
 * AI module types. Context is built from workspace_daily_metrics (DB).
 * Insights follow Triple Whale–style: title, reason, actionable recommendation.
 */

export type DailyMetricRow = {
  date: string
  netSales: number
  grossSales: number
  totalTax: number
  totalDiscount: number
  ordersCount: number
  aov: number
  currency: string
  cogs: number
  shipping: number
  packaging: number
  websiteCharges: number
  cm1: number
  metaAdSpend: number
  googleAdSpend: number
  totalAdSpend: number
  cm2: number
  miscExpensesProrated: number
  cm3: number
  acos: number | null
  blendedRoas: number | null
  sessions: number | null
  conversionRate: number | null
  rtoOrders: number | null
  rtoValue: number | null
  rtoPercent: number | null
  rtoMapped: number | null
  rtoUnmapped: number | null
  totalShipments: number | null
  prepaidOrdersCount: number | null
  prepaidPercentage: number | null
}

export type WorkspaceMetricsSummary = {
  totalNetSales: number
  totalGrossSales: number
  totalOrders: number
  avgAov: number
  totalCogs: number
  totalShipping: number
  totalPackaging: number
  totalWebsiteCharges: number
  cm1: number
  totalMetaAdSpend: number
  totalGoogleAdSpend: number
  totalAdSpend: number
  cm2: number
  miscExpensesProrated: number
  cm3: number
  blendedRoas: number | null
  acos: number | null
  currency: string
  totalSessions: number | null
  avgConversionRate: number | null
  rtoOrders: number | null
  rtoValue: number | null
  rtoPercent: number | null
  totalShipments: number | null
  prepaidOrdersCount: number | null
  prepaidPercentage: number | null
}

export type WorkspaceMetricsContext = {
  period: { from: string; to: string; days: number }
  daily: DailyMetricRow[]
  summary: WorkspaceMetricsSummary | null
}

/** Triple Whale–style insight: performance alert, ROAS, margin, RTO, etc. */
export type InsightType =
  | 'performance_alert'
  | 'roas_drop'
  | 'margin_risk'
  | 'ad_efficiency'
  | 'sales_trend'
  | 'rto_alert'
  | 'prepaid_trend'
  | 'conversion_insight'
  | 'revenue_opportunity'

export type AiInsight = {
  insight_type: InsightType
  title: string
  reason: string
  recommendation: string
  confidence: number
  /** Optional: high | medium | low for UI styling */
  severity?: 'high' | 'medium' | 'low'
}

export type TrendSnapshot = {
  netSalesPctChange: number
  ordersPctChange: number
  aovPctChange: number
  adSpendPctChange: number
  blendedRoasPctChange: number | null
  cm2PctChange: number
  cm3PctChange: number
}
