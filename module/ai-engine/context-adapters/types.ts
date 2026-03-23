export type DateRange = {
  from: Date
  to: Date
}

export type CompressedDailyRow = {
  date: string
  [key: string]: string | number
}

export type GoalContext = {
  metricName: string
  label: string
  goal: number
  actual: number
  variancePct: number | null
  rag: 'green' | 'amber' | 'red'
}

export type PageContext = {
  page: string
  workspaceId: string
  dateRange: DateRange
  priorDateRange: DateRange
  summary: Record<string, number | null>
  priorSummary: Record<string, number | null>
  daily: CompressedDailyRow[]
  currency: string
  goals?: GoalContext[]
  /** Page-specific structured data (e.g. top campaigns for ads pages) */
  extra?: Record<string, unknown>
}
