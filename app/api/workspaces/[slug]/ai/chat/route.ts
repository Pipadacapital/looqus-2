import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { loadContextWithTrend, chatWithContext, computeSignals } from '@/module/ai'

const DEFAULT_DAYS = 30
const MAX_DAYS = 90

/**
 * POST /api/workspaces/[slug]/ai/chat
 * Body: { message: string, model?: string, days?: number, stream?: boolean }
 * Returns NDJSON stream { delta } / { done: true } / { error } or JSON { reply, modelUsed }.
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
  let body: { message?: string; messages?: { role: string; content: string }[]; model?: string; days?: number; stream?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const stream = body.stream === true
  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(body.days) || DEFAULT_DAYS)
  )
  const model = body.model?.trim() || undefined

  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const history: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(body.messages)
    ? body.messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).trim() }))
        .filter((m) => m.content.length > 0)
    : []
  const messages = [...history, { role: 'user' as const, content: message }]

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

  const { context: metricsContext, priorContext } = await loadContextWithTrend(
    prisma,
    workspace.id,
    days
  )

  const signals = computeSignals(
    metricsContext.daily,
    metricsContext.summary,
    priorContext.summary
  )

  const hasData = metricsContext.summary != null || metricsContext.daily.length > 0
  const fallback =
    "I don't have any workspace metrics for this period yet. Run the workspace daily metrics populate script or ensure your data sources (Shopify, Meta, Google, Shiprocket) are connected and synced."

  if (!hasData) {
    if (stream) {
      const encoder = new TextEncoder()
      const streamBody = new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode(JSON.stringify({ delta: fallback, done: true }) + '\n'))
          c.close()
        },
      })
      return new Response(streamBody, {
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    }
    return NextResponse.json({ reply: fallback, modelUsed: null })
  }

  if (stream) {
    const encoder = new TextEncoder()
    const streamBody = new ReadableStream({
      async start(controller) {
        try {
          const result = await chatWithContext(metricsContext, messages, {
            model,
            stream: true,
            signals,
          })
          if (!result.stream || !('streamGenerator' in result)) {
            controller.enqueue(encoder.encode(JSON.stringify({ delta: (result as { reply: string }).reply ?? '', done: true }) + '\n'))
            controller.close()
            return
          }
          for await (const delta of result.streamGenerator) {
            controller.enqueue(encoder.encode(JSON.stringify({ delta }) + '\n'))
          }
          controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'))
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Chat failed'
          controller.enqueue(encoder.encode(JSON.stringify({ error: msg }) + '\n'))
        } finally {
          controller.close()
        }
      },
    })
    return new Response(streamBody, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  }

  try {
    const result = await chatWithContext(metricsContext, messages, { model, stream: false, signals })
    const reply = 'reply' in result ? result.reply : ''
    const modelUsed = result.modelUsed
    return NextResponse.json({ reply, modelUsed })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Chat failed'
    return NextResponse.json(
      { error: msg, reply: null, modelUsed: null },
      { status: 500 }
    )
  }
}
