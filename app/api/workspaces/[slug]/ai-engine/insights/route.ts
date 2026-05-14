import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { generatePageInsight } from '@/module/ai-engine'

/**
 * GET /api/workspaces/[slug]/ai-engine/insights
 * Query params: page, from (YYYY-MM-DD), to (YYYY-MM-DD), refresh (optional)
 * Returns JSON: { insights, cached, model } or { error }
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
  const page = searchParams.get('page')
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const forceRefresh = searchParams.get('refresh') === 'true'

  if (!page || !fromParam || !toParam) {
    return NextResponse.json(
      { error: 'Missing required params: page, from, to' },
      { status: 400 }
    )
  }

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

  const fromDate = new Date(`${fromParam}T00:00:00.000Z`)
  const toDate = new Date(`${toParam}T23:59:59.999Z`)

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  try {
    const result = await generatePageInsight(
      prisma,
      workspace.id,
      page,
      fromDate,
      toDate,
      { forceRefresh }
    )

    return NextResponse.json({
      insights: result.insights,
      cached: result.cached,
      model: result.modelUsed,
      error: result.error,
      message: result.message,
      dataThrough: result.dataThrough,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate insight'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
