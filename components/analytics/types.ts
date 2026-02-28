/** Summary returned by GET /api/workspaces/[slug]/shopify-analytics */
export interface ShopifyAnalyticsSummary {
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
  /** CM2 = CM1 - Total Ad spend (profit after ad spend). */
  cm2?: number
  /** Total miscellaneous expenses in the period. */
  miscExpensesTotal?: number
  /** CM3 = CM2 - Miscellaneous Expenses. */
  cm3?: number
  currency: string
  from: string
  to: string
  /** Percentage of orders that are prepaid (financial status Paid). From synced orders. */
  prepaidPercentage?: number | null
  /** Total storefront sessions in the period. From ShopifyQL sessions dataset. */
  totalSessions?: number | null
  /** Average conversion rate in the period (e.g. 0.025 = 2.5%). From ShopifyQL. */
  conversionRate?: number | null
  /** Meta Ads spend for the period (converted to summary currency). */
  metaAdSpend?: number
  /** Google Ads spend for the period (converted to summary currency). */
  googleAdSpend?: number
  /** Total ad spend (Meta + Google) for the period. */
  totalAdSpend?: number
  /** ACOS (Advertising Cost of Sales) = (Total Ad spend / Total Revenue) × 100. Uses net sales as revenue. */
  acos?: number | null
  /** Count of shipments with an RTO tracking status in the period. */
  rtoOrders?: number
  /** RTO shipments / total shipments × 100. */
  rtoPercent?: number | null
  /** Sum of Shopify order values for RTO-mapped shipments. */
  rtoValue?: number
  /** How many RTO shipments were successfully mapped to a Shopify order. */
  rtoMapped?: number
  /** How many RTO shipments could not be mapped (missing channel_order_id). */
  rtoUnmapped?: number
  /** Total shipments shipped in the period. */
  totalShipmentsInRange?: number
}

export function formatCurrency(
  value: number,
  currency: string,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }
): string {
  const symbol = currency === 'INR' ? '₹' : '$'
  return `${symbol}${value.toLocaleString('en-IN', options)}`
}
