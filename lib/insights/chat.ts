import { ollamaGenerate, ollamaGenerateStream } from '@/lib/ollama/client'
import { buildMetricsText } from '@/lib/insights/insight-builder'
import type { AggregatedMetrics } from '@/lib/insights/types'

const DEFAULT_MODEL = process.env.OLLAMA_INSIGHTS_MODEL ?? 'llama3.2'

function buildChatSystemPrompt(metrics: AggregatedMetrics, insightsSummary?: string): string {
  const metricsText = buildMetricsText(metrics)
  let prompt = `You are an e-commerce analytics assistant. You help users understand their ad and sales performance. You have access ONLY to the following aggregated metrics. You do NOT execute code or access external systems.

Current metrics (use these to answer questions):
---
${metricsText}
---
`
  if (insightsSummary) {
    prompt += `\nRecent AI-generated insights (for context):\n${insightsSummary}\n\n`
  }
  prompt += `Answer the user's question concisely based on the metrics above. If they ask about ROAS, campaigns, spend, or recommendations, use the numbers provided. If the data does not include what they need, say so. Keep answers clear and actionable. Format your response in Markdown: use **bold** for emphasis, - or * for bullet lists, and ## for section headers so it renders clearly.`
  return prompt
}

export async function getChatReply(
  metrics: AggregatedMetrics,
  userMessage: string,
  options: { insightsSummary?: string; model?: string } = {}
): Promise<{ reply: string; modelUsed: string }> {
  const model = options.model ?? DEFAULT_MODEL
  const system = buildChatSystemPrompt(metrics, options.insightsSummary)

  const response = await ollamaGenerate({
    model,
    prompt: userMessage.trim(),
    system,
    stream: false,
  })

  const reply = response.response?.trim() ?? 'I couldn’t generate a response. Please try again.'
  return { reply, modelUsed: model }
}

/** Stream chat reply for realtime ChatGPT-style UI. Yields text deltas. */
export async function* getChatReplyStream(
  metrics: AggregatedMetrics,
  userMessage: string,
  options: { insightsSummary?: string; model?: string } = {}
): AsyncGenerator<string, void, unknown> {
  const model = options.model ?? DEFAULT_MODEL
  const system = buildChatSystemPrompt(metrics, options.insightsSummary)
  yield* ollamaGenerateStream({
    model,
    prompt: userMessage.trim(),
    system,
  })
}
