import type { IntentClassifierResult, PipelineIntent } from './types'

const KEYWORDS: Record<PipelineIntent, string[]> = {
  insights: ['insight', 'insights', 'recommendation', 'recommendations', 'what\'s wrong', 'what is wrong', 'alert', 'alerts'],
  chat: ['why', 'how', 'explain', 'what', 'tell me', '?', 'summarize', 'describe'],
  trends: ['trend', 'trends', 'trending', 'over time', 'compare period', 'vs last'],
  anomalies: ['anomaly', 'anomalies', 'outlier', 'unusual', 'spike', 'drop', 'weird', 'abnormal'],
  summary: ['summary', 'summarise', 'overview', 'brief', 'quick summary', 'tl;dr', 'tldr'],
}

/**
 * Classify user question into pipeline intent (rule-based). No LLM call.
 * For "generate insights" flow we use intent=insights by default; for chat we pass the message here.
 */
export function classifyIntent(userInput: string): IntentClassifierResult {
  const q = userInput.trim().toLowerCase()
  if (!q) return { intent: 'chat', confidence: 0.5 }

  let best: { intent: PipelineIntent; score: number } = { intent: 'chat', score: 0 }

  for (const [intent, words] of Object.entries(KEYWORDS)) {
    const score = words.reduce((acc, w) => acc + (q.includes(w) ? 1 : 0), 0)
    if (score > best.score) best = { intent: intent as PipelineIntent, score }
  }

  const confidence = best.score > 0 ? Math.min(0.5 + best.score * 0.2, 0.95) : 0.5
  return { intent: best.intent, confidence }
}

/** For programmatic "generate insights" button we skip classifier and use this. */
export function intentForInsights(): IntentClassifierResult {
  return { intent: 'insights', confidence: 1 }
}
