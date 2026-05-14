export type TimingsMetric = 'median' | 'mean'
export type TimingsGroupBy = 'product' | 'variant' | 'vendor' | 'productType'

export interface TimingsSummary {
  firstOrders: number
  secondOrdersPct: number
  thirdOrdersPct: number
  fourthOrdersPct: number
  median1to2: number
  median2to3: number
  median3to4: number
  reactivationDays: number
}

export interface TimingsGroupRow {
  id: string
  label: string
  groupBy: TimingsGroupBy
  firstOrders: number
  secondOrdersPct: number
  thirdOrdersPct: number
  fourthOrdersPct: number
  days1to2: number | null
  days2to3: number | null
  days3to4: number | null
  reactivationDays: number | null
}

export interface TimingsParams {
  from: string // YYYY-MM-DD
  to: string
  metric: TimingsMetric
  groupBy?: TimingsGroupBy
  groupId?: string
}

export interface TimingsResponse {
  summary: TimingsSummary
  groups: TimingsGroupRow[]
  currency: string
}
