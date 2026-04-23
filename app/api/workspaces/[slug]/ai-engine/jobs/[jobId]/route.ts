import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'

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
 * GET /api/workspaces/[slug]/ai-engine/jobs/[jobId]
 * Poll for job status. jobId is actually a filtersHash.
 * Finds the latest ai_insights row matching that hash.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string; jobId: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug, jobId: filtersHash } = await context.params

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

  // Look up the latest row by filtersHash (the pipeline's saveInsight replaces rows by hash)
  const job = await prisma.aiInsight.findFirst({
    where: {
      workspaceId: workspace.id,
      filtersHash,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      content: true,
      model: true,
      metadata: true,
      page: true,
    },
  })

  if (!job) {
    // No row yet — pipeline hasn't saved anything. Still processing.
    return NextResponse.json({ status: 'processing' })
  }

  const meta = job.metadata as Record<string, unknown> | null

  if (job.status === 'done') {
    let insights = null
    try {
      const parsed = parseContentJson(job.content)
      insights = parsed?.insights ?? parsed ?? []
    } catch {
      insights = []
    }

    return NextResponse.json({
      status: 'done',
      page: job.page,
      insights,
      model: job.model,
      dataThrough: (meta?.dataThrough as string) ?? null,
    })
  }

  if (job.status === 'failed') {
    let error = 'Generation failed'
    try {
      const parsed = JSON.parse(job.content)
      error = parsed.message || parsed.error || error
    } catch {
      // keep default
    }

    return NextResponse.json({
      status: 'failed',
      page: job.page,
      error,
      dataThrough: (meta?.dataThrough as string) ?? null,
    })
  }

  // Still processing
  return NextResponse.json({
    status: job.status,
    page: job.page,
  })
}
