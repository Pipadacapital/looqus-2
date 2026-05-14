import { ollamaGenerate } from '@/lib/ollama/client'
import type { AggregatedMetrics, StructuredInsight, StructuredInsightResponse } from '@/lib/insights/types'

const DEFAULT_MODEL = process.env.OLLAMA_INSIGHTS_MODEL ?? 'llama3.2'

// Use format: "json" for compatibility with all Ollama versions

/** Exported for chat context. */
export function buildMetricsText(metrics: AggregatedMetrics): string {
  const lines: string[] = [
    `Period: ${metrics.period.from} to ${metrics.period.to} (${metrics.period.days} days)`,
  ]
  if (metrics.meta) {
    lines.push(
      '',
      'Meta Ads:',
      `  Total spend: $${metrics.meta.spend.toFixed(2)}, Revenue: $${metrics.meta.revenue.toFixed(2)}, ROAS: ${metrics.meta.roas.toFixed(2)} (attributed: revenue/spend)`,
      `  Impressions: ${metrics.meta.impressions}, Clicks: ${metrics.meta.clicks}, Conversions: ${metrics.meta.conversions}, CTR: ${metrics.meta.ctr.toFixed(2)}%, CPC: $${metrics.meta.cpc.toFixed(2)}, CPM: $${metrics.meta.cpm.toFixed(2)}`,
      '  Top campaigns by spend:',
      ...metrics.meta.topCampaigns.slice(0, 5).map(
        (c) => `    - ${c.name}: spend $${c.spend.toFixed(2)}, revenue $${c.revenue.toFixed(2)}, ROAS ${c.roas.toFixed(2)}`
      )
    )
  }
  if (metrics.google) {
    lines.push(
      '',
      'Google Ads:',
      `  Total spend: $${metrics.google.spend.toFixed(2)}, Conversion value: $${metrics.google.conversionValue.toFixed(2)}, ROAS: ${metrics.google.roas.toFixed(2)} (attributed: conversion value/spend)`,
      `  Impressions: ${metrics.google.impressions}, Clicks: ${metrics.google.clicks}, Conversions: ${metrics.google.conversions}, CTR: ${metrics.google.ctr.toFixed(2)}%, CPC: $${metrics.google.cpc.toFixed(2)}, CPM: $${metrics.google.cpm.toFixed(2)}`,
      '  Top campaigns by spend:',
      ...metrics.google.topCampaigns.slice(0, 5).map(
        (c) => `    - ${c.name}: spend $${c.spend.toFixed(2)}, conversion value $${c.conversionValue.toFixed(2)}, ROAS ${c.roas.toFixed(2)}`
      )
    )
  }
  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are an e-commerce analytics assistant. You analyze aggregated ad and sales metrics only. You do NOT execute code or access external systems.

Definitions: ROAS here is attributed ROAS only (platform-reported conversion value or revenue divided by ad spend). We do not have blended ROAS (total order revenue / spend), contribution margin, or return rate in this data.

Given metrics (Meta Ads, Google Ads: spend, revenue/conversion value, attributed ROAS, impressions, clicks, conversions, CTR, CPC, CPM, top campaigns), produce 1 to 4 short insights.

Insight types to use when relevant:
- performance_alert: overall performance issue (e.g. low ROAS, high spend low revenue)
- roas_drop: ROAS declining or below target; suggest possible causes (creative, audience, seasonality)
- high_returns: mention if return or refund data is not in the metrics; otherwise flag risk if implied
- margin_risk: when spend is high relative to revenue or conversion value
- ad_efficiency: suggestions to improve CTR, CPC, or campaign structure

Rules:
- Each insight must have: insight_type, title, reason, recommendation, confidence.
- Be concise. One or two sentences for reason and recommendation.
- Recommendations must be specific and actionable (reference campaigns, channels, or metrics by name when possible), not generic.
- confidence: 0.0 to 1.0 based on how clear the data supports the insight.
- Output ONLY valid JSON: {"insights": [{"insight_type":"...", "title":"...", "reason":"...", "recommendation":"...", "confidence":0.8}, ...]}. No markdown, no code block.

Example format (follow this structure):
{"insights": [{"insight_type":"roas_drop","title":"Meta ROAS below 3x","reason":"Meta ROAS is 2.1 with $50k spend; top campaign LQ | TOF has 2.5x.","recommendation":"Test creatives or narrow audiences on LQ | TOF; consider shifting 20% spend to higher-ROAS campaigns.","confidence":0.85}]}`

/**
 * Builds a prompt from metrics and calls local Ollama to get structured insights.
 * Returns parsed insights or empty array on parse/validation errors.
 * On Ollama/network errors, throws so the API can surface the error to the user.
 */
export async function buildInsightsFromMetrics(
  metrics: AggregatedMetrics,
  options: { model?: string } = {}
): Promise<{ insights: StructuredInsight[]; modelUsed: string; error?: string }> {
  const model = options.model ?? DEFAULT_MODEL
  const metricsText = buildMetricsText(metrics)
  const userPrompt = `Analyze these metrics and return insights as JSON.\n\n${metricsText}`

  console.log('[insight-builder] model:', model, 'prompt length:', userPrompt.length)

  let response: { response?: string }
  try {
    response = await ollamaGenerate({
      model,
      prompt: userPrompt,
      system: SYSTEM_PROMPT,
      stream: false,
      format: 'json',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[insight-builder] ollamaGenerate failed:', msg)
    throw new Error(msg)
  }

  const raw = response.response?.trim() ?? ''
  console.log('[insight-builder] ollama response length:', raw.length, 'first 200 chars:', raw.slice(0, 200))

  if (!raw) {
    console.log('[insight-builder] empty response from Ollama')
    return { insights: [], modelUsed: model, error: 'Ollama returned empty response.' }
  }

  try {
    const jsonStr = raw.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(jsonStr) as StructuredInsightResponse

    if (!Array.isArray(parsed?.insights)) {
      console.log('[insight-builder] parsed.insights is not array:', typeof parsed?.insights)
      return { insights: [], modelUsed: model, error: 'Ollama response was not valid insights JSON.' }
    }

    const insights = parsed.insights.filter(
      (i): i is StructuredInsight =>
        typeof i?.insight_type === 'string' &&
        typeof i?.reason === 'string' &&
        typeof i?.recommendation === 'string' &&
        typeof i?.confidence === 'number' &&
        (i.title === undefined || typeof i.title === 'string')
    ).map((i) => ({ ...i, title: i.title ?? i.insight_type }))
    console.log('[insight-builder] parsed insights count:', insights.length)
    return { insights, modelUsed: model }
  } catch (parseErr) {
    console.error('[insight-builder] JSON parse failed:', parseErr)
    return { insights: [], modelUsed: model, error: 'Could not parse Ollama response as JSON.' }
  }
}
