/**
 * AI v2 Context API — returns full computed context as JSON.
 * GET /api/workspaces/[slug]/ai-2/context?days=30
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { buildFullAiContext } from '@/lib/ai-calc'

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
    return NextResponse.json(aiContext)
  } catch (err) {
    console.error('[ai-2/context] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
