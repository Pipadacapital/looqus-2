import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'
import { computeCacheKey, getCachedInsight, saveInsight } from '@/module/ai-engine/cache/insight-cache'
import { generatePageInsight } from '@/module/ai-engine'

/** Strip markdown code fences and parse JSON from AI response content */
function parseContentJson(raw: string): any {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  const startIdx = cleaned.indexOf('{')
  const endIdx = cleaned.lastIndexOf('}')
  if (startIdx === -1 || endIdx === -1) return null
  return JSON.parse(cleaned.slice(startIdx, endIdx + 1))
}

/**
 * POST /api/workspaces/[slug]/ai-engine/jobs
 * Creates an insight generation job. If cache is valid, returns immediately.
 * Otherwise, creates a pending DB record and generates async.
 *
 * Body: { page, from, to, forceRefresh? }
 * Returns: { jobId, status, insights?, model?, dataThrough? }
 */
export async function POST(
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

  let body: { page?: string; from?: string; to?: string; forceRefresh?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { page, from: fromParam, to: toParam, forceRefresh = false } = body

  if (!page || !fromParam || !toParam) {
    return NextResponse.json(
      { error: 'Missing required fields: page, from, to' },
      { status: 400 }
    )
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true, features: true },
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

  const guard = featureGuard(workspace.features as any, 'ai_insights')
  if (guard) return guard

  const fromDate = new Date(`${fromParam}T00:00:00.000Z`)
  const toDate = new Date(`${toParam}T23:59:59.999Z`)

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  const filtersHash = computeCacheKey(workspace.id, page, fromParam, toParam)

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await getCachedInsight(prisma, workspace.id, filtersHash)
    if (cached && !cached.isExpired) {
      try {
        const parsed = parseContentJson(cached.content)
        if (parsed) {
          const meta = cached.metadata as Record<string, unknown> | null
          return NextResponse.json({
            jobId: 'cache',
            status: 'done',
            insights: parsed.insights ?? parsed,
            model: 'cache',
            dataThrough: (meta?.dataThrough as string) ?? null,
          })
        }
      } catch {
        // Invalid cache — proceed to generate
      }
    }
  }

  // Clear any existing rows for this hash so the poll doesn't return stale data
  await prisma.aiInsight.deleteMany({
    where: { workspaceId: workspace.id, filtersHash },
  })

  // Fire-and-forget: generate in background
  // The pipeline's saveInsight() will create/replace the cache row keyed by filtersHash.
  // We poll by filtersHash, so we don't need a separate "job" row.
  generatePageInsight(prisma, workspace.id, page, fromDate, toDate, {
    forceRefresh: true,
  })
    .then(async (result) => {
      // If the pipeline returned an error (e.g. insufficient_data), it doesn't save a row.
      // Save a failed row so the poll endpoint can report it.
      if (result.error) {
        await saveInsight(prisma, {
          workspaceId: workspace.id,
          page,
          dateFrom: fromDate,
          dateTo: toDate,
          filtersHash,
          content: JSON.stringify({ error: result.error, message: result.message }),
          provider: 'none',
          model: 'none',
          tokensUsed: 0,
          latencyMs: 0,
          status: 'failed',
          metadata: result.dataThrough ? { dataThrough: result.dataThrough } : undefined,
        })
      }
    })
    .catch(async (err) => {
      // Pipeline threw — save a failed row so the poll can report it
      const message = err instanceof Error ? err.message : 'Unknown error'
      await saveInsight(prisma, {
        workspaceId: workspace.id,
        page,
        dateFrom: fromDate,
        dateTo: toDate,
        filtersHash,
        content: JSON.stringify({ error: message }),
        provider: 'none',
        model: 'none',
        tokensUsed: 0,
        latencyMs: 0,
        status: 'failed',
      }).catch(() => {})
    })

  return NextResponse.json({
    jobId: filtersHash,
    status: 'processing',
  })
}
