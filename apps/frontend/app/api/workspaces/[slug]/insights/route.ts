import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { buildInsightsFromMetrics } from '@/lib/insights/insight-builder'
import { getAggregatedMetrics } from '@/lib/insights/aggregate-workspace-metrics'
import { computeTrend } from '@/lib/insights/trend'
import { getAnomalies } from '@/lib/insights/anomalies'

const DEFAULT_DAYS = 30
const MAX_DAYS = 90

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  console.log('[insights] auth:', user ? { id: user.id, email: user.email } : 'no user')

  if (!user) {
    console.log('[insights] 401 Unauthorized - no session')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  console.log('[insights] workspace slug:', slug)
  const { searchParams } = new URL(request.url)
  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(searchParams.get('days')) || DEFAULT_DAYS)
  )

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      meta_ads_connections: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          selected_ad_account_id: true,
          ad_account_ids: true,
        },
      },
      google_ads_connections: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          selected_customer_id: true,
          customer_ids: true,
        },
      },
    },
  })

  if (!workspace) {
    console.log('[insights] 404 workspace not found:', slug)
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
    console.log('[insights] 403 Forbidden - user not member of workspace:', workspace.id)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const since = new Date()
  since.setDate(since.getDate() - days)
  since.setHours(0, 0, 0, 0)

  const aggregated = await getAggregatedMetrics(prisma, workspace, since, days)
  const hasMetrics = aggregated.meta || aggregated.google
  console.log('[insights] aggregated:', { hasMeta: !!aggregated.meta, hasGoogle: !!aggregated.google, hasMetrics })

  if (!hasMetrics) {
    console.log('[insights] no ad metrics - returning early')
    return NextResponse.json({
      insights: [],
      trend: null,
      anomalies: [],
      recommendations: [],
      modelUsed: null,
      error: 'No ad metrics available. Connect Meta or Google Ads and sync.',
    })
  }

  const sincePrior = new Date(since)
  sincePrior.setDate(sincePrior.getDate() - days)
  const priorAggregated = await getAggregatedMetrics(prisma, workspace, sincePrior, days)
  const trend = computeTrend(aggregated, priorAggregated)
  const anomalies = await getAnomalies(prisma, workspace, since, days)

  try {
    console.log('[insights] calling buildInsightsFromMetrics...')
    const { insights, modelUsed, error: insightError } = await buildInsightsFromMetrics(aggregated)
    console.log('[insights] result:', { count: insights.length, modelUsed, insightError: insightError ?? null })
    const recommendations = insights.map((i) => ({
      title: i.title,
      text: i.recommendation,
    }))
    return NextResponse.json({
      insights,
      trend,
      anomalies,
      recommendations,
      modelUsed,
      period: aggregated.period,
      ...(insightError && { error: insightError }),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Insight generation failed'
    console.error('[insights] buildInsightsFromMetrics threw:', e)
    return NextResponse.json(
      {
        insights: [],
        trend,
        anomalies,
        recommendations: [],
        modelUsed: null,
        error: message,
      },
      { status: 200 }
    )
  }
}
