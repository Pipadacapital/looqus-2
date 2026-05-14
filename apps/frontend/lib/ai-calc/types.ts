/**
 * Unified types for all AI calculation modules.
 * Each module returns a slice of FullAiContext.
 */

// ─── Analytics ──────────────────────────────────────────

export interface AiDailyRow {
  date: string
  netSales: number
  grossSales: number
  totalTax: number
  totalDiscount: number
  ordersCount: number
  aov: number
  cogs: number
  shipping: number
  packaging: number
  websiteCharges: number
  cm1: number
  currency: string
  sessions: number | null
  conversionRate: number | null
}

export interface AiAnalyticsSummary {
  totalNetSales: number
  totalGrossSales: number
  totalTax: number
  totalDiscount: number
  totalOrders: number
  avgAov: number
  totalCogs: number
  totalShipping: number
  totalPackaging: number
  totalWebsiteCharges: number
  cm1: number
  currency: string
  prepaidPercentage: number | null
  totalSessions: number | null
  conversionRate: number | null
}

export interface AiAnalyticsData {
  daily: AiDailyRow[]
  summary: AiAnalyticsSummary
}

// ─── P&L ────────────────────────────────────────────────

export interface AiPnlSummary {
  grossSales: number
  discounts: number
  netSales: number
  refunds: number
  revenue: number
  netRevenue: number
  cogs: number
  variableCosts: number
  shippingCosts: number
  cm1: number
  adSpend: number
  metaAdSpend: number
  googleAdSpend: number
  cm2: number
  fixedCosts: number
  cm3: number
  founderSalary: number
  netProfit: number
  ordersCount: number
  cm1Margin: number | null
  cm2Margin: number | null
  cm3Margin: number | null
  netProfitMargin: number | null
}

export interface AiPnlData {
  summary: AiPnlSummary
  currency: string
}

// ─── Ads ─────────────────────────────────────────────────

export interface AiAdCampaign {
  campaignId: string
  campaignName: string
  platform: 'meta' | 'google'
  spend: number
  impressions: number
  clicks: number
  conversions: number
  roas: number | null
  cpc: number | null
  ctr: number | null
}

export interface AiAdsSummary {
  metaSpend: number
  googleSpend: number
  totalSpend: number
  blendedRoas: number | null
  acos: number | null
  topCampaigns: AiAdCampaign[]
}

export interface AiAdsData {
  summary: AiAdsSummary
  currency: string
}

// ─── Orders & RTO ────────────────────────────────────────

export interface AiOrdersSummary {
  totalOrders: number
  prepaidOrders: number
  prepaidPercentage: number | null
  codOrders: number
  rtoOrders: number
  rtoPercent: number | null
  rtoValue: number
  totalShipments: number
  shiprocketConnected: boolean
}

export interface AiOrdersData {
  summary: AiOrdersSummary
}

// ─── Cohorts ─────────────────────────────────────────────

export interface AiCohortsSummary {
  averageCac: number
  avg90DayRepeat: number
  averagePayback: number | null
  newCustomers: number
  topCohortMonth: string | null
  topCohortRepeat: number | null
}

export interface AiCohortsData {
  summary: AiCohortsSummary
  currency: string
}

// ─── Timings ─────────────────────────────────────────────

export interface AiTimingsSummary {
  firstOrders: number
  secondOrdersPct: number
  thirdOrdersPct: number
  fourthOrdersPct: number
  median1to2: number
  median2to3: number
  median3to4: number
  reactivationDays: number
}

export interface AiTimingsData {
  summary: AiTimingsSummary
}

// ─── Inventory ───────────────────────────────────────────

export interface AiInventorySummary {
  totalProducts: number
  totalVariants: number
  totalUnits: number
  deadStockCount: number
  lowStockCount: number
  healthyStockCount: number
  overStockCount: number
  avgSellThroughRate: number | null
  avgDaysLeft: number | null
}

export interface AiInventoryData {
  summary: AiInventorySummary
}

// ─── Recent Orders ──────────────────────────────────────

export interface AiRecentOrder {
  orderNumber: string
  processedAt: string
  customerName: string | null
  customerEmail: string | null
  totalPrice: number
  financialStatus: string | null
  fulfillmentStatus: string | null
  itemCount: number
  currency: string
}

// ─── Full Context ────────────────────────────────────────

export interface FullAiContext {
  period: { from: string; to: string; days: number }
  analytics: AiAnalyticsData
  pnl: AiPnlData
  ads: AiAdsData
  orders: AiOrdersData
  cohorts: AiCohortsData | null
  timings: AiTimingsData | null
  inventory: AiInventoryData | null
  recentOrders: AiRecentOrder[]
}
