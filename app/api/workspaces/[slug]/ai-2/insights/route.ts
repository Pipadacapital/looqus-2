/**
 * AI v2 Insights API — generates Triple Whale-style insights from full context.
 * GET /api/workspaces/[slug]/ai-2/insights?days=30&model=llama3.2
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { buildFullAiContext } from '@/lib/ai-calc'
import { formatContextForPrompt } from '@/lib/ai-calc/format'
import { ollamaGenerate } from '@/module/ai/providers/ollama'

const DEFAULT_MODEL = process.env.OLLAMA_INSIGHTS_MODEL ?? 'llama3.2'

const SYSTEM_PROMPT = `You are an elite e-commerce analytics assistant like Triple Whale. You analyze comprehensive business data — P&L (CM1/CM2/CM3/Net Profit), ad performance (ROAS, CPC, CTR), cohort retention, repurchase timings, inventory health, RTO, and order patterns — to produce powerful, actionable insights.

Definitions:
- CM1 = Net Sales - COGS - Variable Costs (shipping, packaging, website charges)
- CM2 = CM1 - Ad Spend
- CM3 = CM2 - Fixed Costs (misc expenses)
- Net Profit = CM3 - Founder Salary
- Blended ROAS = Net Sales / Total Ad Spend
- ACOS = (Ad Spend / Net Sales) × 100
- RTO = Return-to-origin (failed delivery) shipments
- CAC = Customer Acquisition Cost
- Payback = months until a cohort recoups CAC

Insight types (use exactly these values):
- performance_alert: overall performance issue
- roas_drop: declining or low ROAS
- margin_risk: margin squeeze (CM2/CM3 deteriorating)
- ad_efficiency: ad optimization opportunity
- sales_trend: notable sales or order trend
- rto_alert: high RTO rate impacting margins
- prepaid_trend: prepaid % observation
- conversion_insight: sessions/conversion rate finding
- revenue_opportunity: untapped growth opportunity
- inventory_alert: stock health concern (dead stock, low stock)
- cohort_insight: retention or LTV pattern
- timing_insight: repurchase timing finding

Rules:
- Return 3 to 6 insights. Each must have: insight_type, title, reason, recommendation, confidence (0-1), severity (high/medium/low).
- title: concise headline. reason: 1-2 sentences with actual numbers. recommendation: specific, actionable next step.
- Reference actual data from the metrics. Be concise and data-driven.
- Output ONLY valid JSON: {"insights": [{...}]}. No markdown, no code fence.`

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '30', 10) || 30
  const model = searchParams.get('model') || DEFAULT_MODEL

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
  })
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const aiContext = await buildFullAiContext(prisma, workspace.id, slug, days)
    const contextText = formatContextForPrompt(aiContext)
    const userPrompt = `Analyze these comprehensive workspace metrics and return 3 to 6 insights as JSON.\n\n${contextText}`

    const result = await ollamaGenerate({
      model,
      prompt: userPrompt,
      system: SYSTEM_PROMPT,
      format: 'json',
    })

    // Parse insights from response
    let insights = []
    try {
      const parsed = JSON.parse(result.response)
      insights = Array.isArray(parsed.insights) ? parsed.insights : Array.isArray(parsed) ? parsed : []
    } catch {
      return NextResponse.json({
        insights: [],
        modelUsed: result.model,
        error: 'Failed to parse insights from AI response',
        raw: result.response,
      })
    }

    return NextResponse.json({
      insights,
      modelUsed: result.model,
      period: aiContext.period,
    })
  } catch (err) {
    console.error('[ai-2/insights] Error:', err)
    return NextResponse.json({
      insights: [],
      modelUsed: model,
      error: err instanceof Error ? err.message : 'Internal error',
    })
  }
}
