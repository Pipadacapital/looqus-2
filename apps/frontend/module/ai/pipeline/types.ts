/**
 * AI pipeline types: User question → Intent → Metrics → Context (with signals) → Model → Response.
 */

export type PipelineIntent =
  | 'insights'   // Generate insight cards (anomalies, trends, recommendations)
  | 'chat'       // Q&A about metrics
  | 'trends'     // Focus on trend summary
  | 'anomalies'  // Focus on anomalies only
  | 'summary'    // Short summary

/** One detected anomaly: metric deviates significantly from recent norm. */
export type SignalAnomaly = {
  type: 'anomaly'
  metric: string
  date: string
  value: number
  expectedOrAverage: number
  deviation: number // e.g. z-score or % diff
  direction: 'high' | 'low'
  description: string
}

/** Spike: sharp increase day-over-day. */
export type SignalSpike = {
  type: 'spike'
  metric: string
  date: string
  value: number
  priorValue: number
  pctChange: number
  description: string
}

/** Drop: sharp decrease day-over-day. */
export type SignalDrop = {
  type: 'drop'
  metric: string
  date: string
  value: number
  priorValue: number
  pctChange: number
  description: string
}

/** Trend: period-over-period or directional. */
export type SignalTrend = {
  type: 'trend'
  metric: string
  direction: 'up' | 'down' | 'flat'
  pctChange: number | null
  currentPeriodValue: number
  priorPeriodValue: number
  description: string
}

export type PipelineSignals = {
  anomalies: SignalAnomaly[]
  spikes: SignalSpike[]
  drops: SignalDrop[]
  trends: SignalTrend[]
}

export type IntentClassifierResult = {
  intent: PipelineIntent
  confidence: number
  /** Optional: extracted date range or metric focus from question */
  focus?: string
}
