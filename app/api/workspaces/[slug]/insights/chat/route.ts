import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { getAggregatedMetrics } from '@/lib/insights/aggregate-workspace-metrics'
import { getChatReply, getChatReplyStream } from '@/lib/insights/chat'

const DEFAULT_DAYS = 30
const MAX_DAYS = 90

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
  let body: { message?: string; stream?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const stream = body.stream === true
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

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

  const days = Math.min(MAX_DAYS, Math.max(1, DEFAULT_DAYS))
  const since = new Date()
  since.setDate(since.getDate() - days)
  since.setHours(0, 0, 0, 0)

  const metrics = await getAggregatedMetrics(prisma, workspace, since, days)
  const hasMetrics = metrics.meta || metrics.google

  if (!hasMetrics) {
    const fallback =
      "I don't have any ad metrics for this workspace yet. Connect Meta or Google Ads, sync data, then try again."
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
          for await (const delta of getChatReplyStream(metrics, message)) {
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
    const { reply, modelUsed } = await getChatReply(metrics, message)
    return NextResponse.json({ reply, modelUsed })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Chat failed'
    return NextResponse.json(
      { error: msg, reply: null, modelUsed: null },
      { status: 500 }
    )
  }
}
