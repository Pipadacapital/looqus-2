import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import {
  loadContextWithTrend,
  generateInsights,
  computeSignals,
} from '@/module/ai'

const DEFAULT_DAYS = 30
const MAX_DAYS = 90

/**
 * GET /api/workspaces/[slug]/ai/insights
 * Query: days (default 30), model (optional Ollama model name)
 * Returns AI insights from workspace_daily_metrics (Triple Whale style) + trend.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(searchParams.get('days')) || DEFAULT_DAYS)
  )
  const model = searchParams.get('model')?.trim() || undefined

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { context: metricsContext, trend, priorContext } = await loadContextWithTrend(
    prisma,
    workspace.id,
    days
  )

  const signals = computeSignals(
    metricsContext.daily,
    metricsContext.summary,
    priorContext.summary
  )

  const { insights, modelUsed, error } = await generateInsights(
    metricsContext,
    { model, signals }
  )

  return NextResponse.json({
    insights,
    trend,
    period: metricsContext.period,
    modelUsed,
    ...(error && { error }),
  })
}
