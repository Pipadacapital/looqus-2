import type { WorkspaceMetricsContext } from '../types'
import type { PipelineSignals } from '../pipeline/types'
import { buildEnrichedContext } from '../pipeline/context-builder'
import { buildMetricsTextForInsights } from './insights'

const CHAT_SYSTEM_PREFIX = `You are an e-commerce analytics assistant. The workspace metrics below are the actual data from the database for the selected period. Use them to answer the user's questions—do not say you lack historical data when this data is provided.

For questions like "summarize last 30 days", "CM1 for the period", or "how is X trending", use the Summary section for totals and the Daily breakdown for per-day values. Always state the period (date range) you are summarizing. Be concise and data-driven. Reference specific numbers (sales, ROAS, CM1, CM2, CM3, RTO, etc.) when relevant. If the metrics truly do not contain the requested information, say so briefly.

Definitions: CM1 = profit after variable costs. CM2 = CM1 minus ad spend. CM3 = CM2 minus misc expenses. Blended ROAS = Net sales / Total ad spend. RTO = return-to-origin (failed delivery) shipments.

`

/**
 * Build system message for chat: prefix + metrics context. If signals provided, includes anomalies, spikes, drops, trends.
 */
export function buildChatSystemMessage(
  ctx: WorkspaceMetricsContext,
  signals?: PipelineSignals | null
): string {
  const metricsText =
    signals != null
      ? buildEnrichedContext(ctx, signals)
      : buildMetricsTextForInsights(ctx)
  const periodNote = `Data period: ${ctx.period.from} to ${ctx.period.to} (${ctx.period.days} days). Use this as the source of truth for "last N days" or period summaries.\n\n`
  return CHAT_SYSTEM_PREFIX + '--- Workspace metrics ---\n\n' + periodNote + metricsText
}
