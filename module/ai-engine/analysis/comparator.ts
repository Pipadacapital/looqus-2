export type MetricComparison = {
  current: number
  prior: number
  change: number
  changePercent: number | null
}

export type PeriodComparison = Record<string, MetricComparison>

/**
 * Computes period-over-period % change for each metric key.
 * Returns null changePercent when prior is zero (avoids division by zero).
 */
export function comparePeriods(
  current: Record<string, number | null | undefined>,
  prior: Record<string, number | null | undefined>,
  metricKeys: string[]
): PeriodComparison {
  const result: PeriodComparison = {}

  for (const key of metricKeys) {
    const curr = current[key] ?? 0
    const prev = prior[key] ?? 0
    const change = curr - prev
    const changePercent = prev !== 0 ? (change / Math.abs(prev)) * 100 : null

    result[key] = { current: curr, prior: prev, change, changePercent }
  }

  return result
}

/** Standard metric keys for the analytics page comparison */
export const ANALYTICS_METRIC_KEYS = [
  'totalNetSales',
  'totalGrossSales',
  'totalOrders',
  'avgAov',
  'totalCogs',
  'materialMargin',
  'materialMarginPct',
  'cm1',
  'cm1Pct',
  'cm2',
  'cm2Pct',
  'cm3',
  'cm3Pct',
  'totalAdSpend',
  'metaAdSpend',
  'googleAdSpend',
  'mer',
  'acos',
  'rtoPercent',
  'prepaidPercentage',
  'conversionRate',
  'totalSessions',
] as const

/** P&L-specific metric keys for period comparison */
export const PNL_METRIC_KEYS = [
  'totalNetSales',
  'totalGrossSales',
  'totalRefunds',
  'totalRevenue',
  'totalNetRevenue',
  'totalCogs',
  'materialMargin',
  'materialMarginPct',
  'totalVariableCosts',
  'totalAdSpend',
  'metaAdSpend',
  'googleAdSpend',
  'cm1',
  'cm1Pct',
  'cm2',
  'cm2Pct',
  'cm3',
  'totalFixedCosts',
  'netProfit',
  'totalOrders',
  'cm3Pct',
  'netProfitPct',
] as const

/** Acquisition-specific metric keys for period comparison */
export const ACQUISITION_METRIC_KEYS = [
  'newCustomers',
  'ncCm2',
  'cm2PerNc',
  'totalAdSpend',
  'metaAdSpend',
  'googleAdSpend',
  'blendedCac',
  'mer',
  'aMer',
  'acos',
] as const

/** Cohort-specific metric keys for period comparison */
export const COHORTS_METRIC_KEYS = [
  'newCustomers',
  'averageCac',
  'avg90DayRepeat',
  'averagePayback',
  'cohortCount',
] as const

/** Meta Ads metric keys for period comparison */
export const META_ADS_METRIC_KEYS = [
  'totalSpend',
  'totalRevenue',
  'totalImpressions',
  'totalClicks',
  'totalConversions',
  'roas',
  'ctr',
  'cpc',
  'cpm',
  'overallCvr',
  'atcRatePct',
  'checkoutPerAtcPct',
  'purchasePerCheckoutPct',
  'acqSpend',
  'acqRevenue',
  'acqRoas',
  'retSpend',
  'retRevenue',
  'retRoas',
] as const

/** COD vs Prepaid metric keys for period comparison */
export const COD_PREPAID_METRIC_KEYS = [
  'codOrders',
  'prepaidOrders',
  'totalOrders',
  'codPercent',
  'codRtoRatePercent',
  'prepaidRtoRatePercent',
  'codRealizationRatePercent',
  'effectiveRevenueCod',
  'effectiveRevenuePrepaid',
  'prepaidPremium',
  'averageOrderValue',
  'breakEvenCodRtoRatePercent',
  'netRevenuePerOrderCod',
  'netRevenuePerOrderPrepaid',
] as const

/** Logistics metric keys for period comparison */
export const LOGISTICS_METRIC_KEYS = [
  'totalShipments',
  'deliveredCount',
  'deliveredPercent',
  'rtoCount',
  'rtoPercent',
  'codCount',
  'prepaidCount',
  'codPercent',
  'forwardCharges',
  'codCharges',
  'rtoCharges',
  'totalShiprocketCharges',
  'avgCostPerShipment',
] as const

/** Pincode Intelligence metric keys for period comparison */
export const PINCODE_INTELLIGENCE_METRIC_KEYS = [
  'totalRevenue',
  'totalOrders',
  'totalShipments',
  'totalPincodes',
  'avgRtoPercent',
  'avgCodPercent',
  'avgDeliveredPercent',
  'avgScore',
  'highRtoPincodes',
  'highCodPincodes',
  'tier1Revenue',
  'tier2Revenue',
  'tier3Revenue',
] as const

/** Products metric keys for period comparison */
export const PRODUCTS_METRIC_KEYS = [
  'totalRevenue',
  'totalCm1',
  'totalSales',
  'totalRefunds',
  'avgCm1Pct',
  'avgReturnRate',
  'totalProducts',
  'gradeACount',
  'gradeFCount',
  'negativeCm1Products',
  'positiveCm1Products',
] as const

/** RTO Analytics metric keys for period comparison */
export const RTO_ANALYTICS_METRIC_KEYS = [
  'totalShipments',
  'rtoCount',
  'rtoRatePercent',
  'totalRtoCost',
  'revenueLostToRto',
  'codRtoCount',
  'prepaidRtoCount',
  'codRtoRatePercent',
  'prepaidRtoRatePercent',
  'codRtoCost',
  'prepaidRtoCost',
  'codRevenueLost',
  'prepaidRevenueLost',
  'avgRtoCostPerShipment',
  'totalLossPerRto',
] as const

/** Waterfall metric keys for period comparison */
export const WATERFALL_METRIC_KEYS = [
  'grossSales',
  'discounts',
  'refunds',
  'tax',
  'shipping',
  'revenueAfterTaxShipping',
  'cogs',
  'variableCosts',
  'rtoCost',
  'cm1',
  'adSpend',
  'cm2',
  'fixedCost',
  'cm3',
  'founderSalary',
  'netProfit',
  'discountPct',
  'refundPct',
  'cogsPct',
  'variableCostsPct',
  'rtoCostPct',
  'adSpendPct',
  'cm1Pct',
  'cm2Pct',
  'cm3Pct',
  'netProfitPct',
  'ordersCount',
] as const

/** LTV metric keys for period comparison */
export const LTV_METRIC_KEYS = [
  'newCustomers',
  'firstOrderR',
  'firstOrder',
  'month1',
  'month3',
  'month6',
  'month12',
  'm1ToM3Lift',
  'm3ToM6Lift',
  'm6ToM12Lift',
] as const

/** Google Ads metric keys for period comparison */
export const GOOGLE_ADS_METRIC_KEYS = [
  'totalSpend',
  'totalConversionValue',
  'totalImpressions',
  'totalClicks',
  'totalConversions',
  'roas',
  'ctr',
  'cpc',
  'overallCvr',
  'atcRatePct',
  'checkoutPerAtcPct',
  'purchasePerCheckoutPct',
  'acqSpend',
  'acqConversionValue',
  'acqRoas',
  'retSpend',
  'retConversionValue',
  'retRoas',
] as const
