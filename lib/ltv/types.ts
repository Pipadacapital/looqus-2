/** Metric: CM2, Revenue, or Repeat Rate */
export type LtvMetric = 'cm2' | 'revenue' | 'repeat_rate'

/** Mode: Cumulative, Post-Acq, Incremental */
export type LtvMode = 'cumulative' | 'post_acq' | 'incremental'

/** Dimension for grouping rows */
export type LtvDimension =
  | 'product'
  | 'variant'
  | 'vendor'
  | 'collection'
  | 'product_type'
  | 'product_tags'
  | 'order_tags'
  | 'discount_codes'
  | 'discount_pct'
  | 'customer_id'

export interface LtvRow {
  dimensionValue: string
  dimensionLabel: string
  ordersCount: number
  newCustomers: number
  firstOrderR: number
  firstOrder: number
  m1: number
  m2: number
  m3: number
  m4: number
  m5: number
  m6: number
  m7: number
  m8: number
  m9: number
  m10: number
  m11: number
  m12: number
}

export interface LtvSummary {
  firstOrderR: number
  firstOrder: number
  month1: number
  month3: number
  month6: number
  month12: number
  newCustomers: number
}

export interface LtvResponse {
  summary: LtvSummary
  rows: LtvRow[]
  totalRows: number
  currency: string
}
