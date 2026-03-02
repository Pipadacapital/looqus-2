import type { WorkspaceMetricsContext } from '../types'
import type { PipelineSignals } from './types'
import { buildMetricsTextForInsights } from '../prompts/insights'

/**
 * Build full context for the LLM: metrics summary + daily + pre-computed signals (anomalies, spikes, drops, trends).
 * The model gets clear ALERT/TREND lines so it can produce more accurate, cited insights.
 */
export function buildEnrichedContext(
  metricsContext: WorkspaceMetricsContext,
  signals: PipelineSignals
): string {
  const metricsText = buildMetricsTextForInsights(metricsContext)
  const lines: string[] = [metricsText]

  const hasSignals =
    signals.anomalies.length > 0 ||
    signals.spikes.length > 0 ||
    signals.drops.length > 0 ||
    signals.trends.length > 0

  if (!hasSignals) return metricsText

  lines.push('')
  lines.push('--- Pre-computed signals (use these to prioritize insights; cite dates/metrics in reason) ---')

  if (signals.anomalies.length > 0) {
    lines.push('')
    lines.push('Anomalies (metric far from period average):')
    signals.anomalies.slice(0, 15).forEach((a) => {
      lines.push(`  - ${a.description}`)
    })
  }

  if (signals.spikes.length > 0) {
    lines.push('')
    lines.push('Spikes (sharp day-over-day increase):')
    signals.spikes.slice(0, 10).forEach((s) => {
      lines.push(`  - ${s.description}`)
    })
  }

  if (signals.drops.length > 0) {
    lines.push('')
    lines.push('Drops (sharp day-over-day decrease):')
    signals.drops.slice(0, 10).forEach((d) => {
      lines.push(`  - ${d.description}`)
    })
  }

  if (signals.trends.length > 0) {
    lines.push('')
    lines.push('Trends (current period vs prior period):')
    signals.trends.forEach((t) => {
      lines.push(`  - ${t.description}`)
    })
  }

  return lines.join('\n')
}
