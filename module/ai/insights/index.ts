import type { WorkspaceMetricsContext, AiInsight } from '../types'
import type { PipelineSignals } from '../pipeline/types'
import { buildEnrichedContext } from '../pipeline/context-builder'
import { ollamaGenerate } from '../providers/ollama'
import { buildInsightsUserPrompt, INSIGHTS_SYSTEM_PROMPT } from '../prompts/insights'
import { parseInsightsResponse } from './parser'

const DEFAULT_MODEL = process.env.OLLAMA_INSIGHTS_MODEL ?? 'llama3.2'

export type GenerateInsightsOptions = { model?: string; signals?: PipelineSignals }

export type GenerateInsightsResult = {
  insights: AiInsight[]
  modelUsed: string
  error?: string
}

/**
 * Generate Triple Whale–style AI insights from workspace metrics context.
 * If options.signals is provided, context is enriched with anomalies, spikes, drops, trends for better insights.
 */
export async function generateInsights(
  context: WorkspaceMetricsContext,
  options: GenerateInsightsOptions = {}
): Promise<GenerateInsightsResult> {
  const model = options.model ?? DEFAULT_MODEL
  const signals = options.signals

  if (!context.summary && context.daily.length === 0) {
    return {
      insights: [],
      modelUsed: model,
      error: 'No metrics data for the selected period. Run workspace daily metrics or sync analytics first.',
    }
  }

  const userPrompt = signals
    ? `Analyze these workspace metrics and return 2 to 5 insights as JSON. Prioritize the pre-computed signals (anomalies, spikes, drops, trends) when relevant.\n\n${buildEnrichedContext(context, signals)}`
    : buildInsightsUserPrompt(context)

  let response: string
  try {
    const result = await ollamaGenerate({
      model,
      prompt: userPrompt,
      system: INSIGHTS_SYSTEM_PROMPT,
      format: 'json',
    })
    response = result.response
    if (!response) {
      return { insights: [], modelUsed: result.model, error: 'Ollama returned empty response.' }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { insights: [], modelUsed: model, error: msg }
  }

  const { insights, error } = parseInsightsResponse(response)
  return {
    insights,
    modelUsed: model,
    ...(error && { error }),
  }
}
