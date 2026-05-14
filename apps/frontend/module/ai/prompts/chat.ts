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

/**
 * Build system message when using tools: no big context dump; model fetches data via tools.
 */
export function buildChatSystemMessageForTools(defaultPeriod: { from: string; to: string; days: number }): string {
  return `You are an e-commerce analytics assistant with access to workspace data via tools. Use the tools to fetch metrics, orders, products, RTO, ads, etc., then answer the user's question with specific numbers.

Default period: ${defaultPeriod.from} to ${defaultPeriod.to} (${defaultPeriod.days} days). When the user says "last 30 days" or "last N days", use that range (from_date = N days ago, to_date = yesterday) unless they specify otherwise. Dates are YYYY-MM-DD.

Definitions: CM1 = profit after variable costs. CM2 = CM1 minus ad spend. CM3 = CM2 minus misc expenses. Blended ROAS = Net sales / Total ad spend. RTO = return-to-origin (failed delivery). Always state the date range you used. Be concise and data-driven.`
}
