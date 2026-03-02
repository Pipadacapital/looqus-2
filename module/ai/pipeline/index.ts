/**
 * AI pipeline: User question → Intent → Metrics fetcher → Context builder (with signals) → Model → Response.
 *
 * Flow:
 * 1. Intent classifier: determine if user wants insights, chat, trends, anomalies, or summary.
 * 2. Metrics fetcher: load workspace_daily_metrics (and prior period for trends).
 * 3. Signals: compute anomalies, spikes, drops, trends from daily data.
 * 4. Context builder: merge metrics text + signals text for the LLM.
 * 5. Model: Ollama generates insight JSON or chat reply.
 */

export type { PipelineIntent, PipelineSignals, IntentClassifierResult } from './types'
export type { SignalAnomaly, SignalSpike, SignalDrop, SignalTrend } from './types'
export { classifyIntent, intentForInsights } from './intent-classifier'
export { computeSignals } from './signals'
export { buildEnrichedContext } from './context-builder'
