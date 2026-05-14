import type { AiInsight, InsightType } from '../types'

const VALID_INSIGHT_TYPES: InsightType[] = [
  'performance_alert',
  'roas_drop',
  'margin_risk',
  'ad_efficiency',
  'sales_trend',
  'rto_alert',
  'prepaid_trend',
  'conversion_insight',
  'revenue_opportunity',
]

function isValidInsightType(s: string): s is InsightType {
  return VALID_INSIGHT_TYPES.includes(s as InsightType)
}

export type ParseResult = { insights: AiInsight[]; error?: string }

/**
 * Parse LLM JSON response into typed AiInsight[].
 * Strips markdown code blocks and validates shape.
 */
export function parseInsightsResponse(raw: string): ParseResult {
  const trimmed = raw
    .replace(/^```json\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  if (!trimmed) return { insights: [], error: 'Empty response' }

  let parsed: { insights?: unknown[] }
  try {
    parsed = JSON.parse(trimmed) as { insights?: unknown[] }
  } catch {
    return { insights: [], error: 'Invalid JSON' }
  }

  if (!Array.isArray(parsed?.insights)) {
    return { insights: [], error: 'Missing or invalid insights array' }
  }

  const insights: AiInsight[] = []
  for (const i of parsed.insights) {
    if (i == null || typeof i !== 'object') continue
    const o = i as Record<string, unknown>
    const type = typeof o.insight_type === 'string' ? o.insight_type : ''
    if (!isValidInsightType(type)) continue
    const title = typeof o.title === 'string' ? o.title : type.replace(/_/g, ' ')
    const reason = typeof o.reason === 'string' ? o.reason : ''
    const recommendation = typeof o.recommendation === 'string' ? o.recommendation : ''
    let confidence = typeof o.confidence === 'number' ? o.confidence : 0.8
    if (confidence < 0 || confidence > 1) confidence = 0.8
    const severity =
      o.severity === 'high' || o.severity === 'medium' || o.severity === 'low'
        ? o.severity
        : undefined
    insights.push({
      insight_type: type,
      title,
      reason,
      recommendation,
      confidence,
      ...(severity && { severity }),
    })
  }

  return { insights }
}
