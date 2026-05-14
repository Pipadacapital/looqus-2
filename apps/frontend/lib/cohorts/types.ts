/** Metric family: what we measure in M1..M12 */
export type CohortMetric = 'cm3' | 'revenue' | 'repeat' | 'repurchase'

/** Display mode: how M1..M12 are transformed */
export type CohortMode = 'post' | 'cumulative' | 'incr' | 'pct' | 'ltvcac'

export interface CohortsParams {
  from: string // YYYY-MM-DD
  to: string
  metric: CohortMetric
  mode: CohortMode
}

export interface CohortRow {
  cohortMonth: string // YYYY-MM
  newCustomers: number
  cac: number
  rr90: number
  payback: number | null // months (0 = immediate), null = not reached
  firstOrder: number
  firstOrderR: number
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

export interface CohortsSummary {
  averageCac: number
  avg90DayRepeat: number
  averagePayback: number | null
  newCustomers: number
}

export interface CohortsResponse {
  summary: CohortsSummary
  rows: CohortRow[]
  currency: string
}
