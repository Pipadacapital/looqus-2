/**
 * AI v2 Chat API — streaming chat with full workspace context.
 * POST /api/workspaces/[slug]/ai-2/chat
 * Body: { messages: [{role, content}], model?, days? }
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { buildFullAiContext } from '@/lib/ai-calc'
import { formatContextForPrompt } from '@/lib/ai-calc/format'
import { ollamaChatStream, ollamaChat } from '@/module/ai/providers/ollama'

const DEFAULT_MODEL = process.env.OLLAMA_INSIGHTS_MODEL ?? 'llama3.2'

const CHAT_SYSTEM_PREFIX = `You are an elite e-commerce analytics assistant with complete access to the workspace's business data. The comprehensive metrics below are computed from actual database records — P&L, daily analytics, ad performance, cohort retention, repurchase timings, inventory health, orders, and RTO data.

Use these metrics to answer questions accurately. Always reference specific numbers. State the period you are summarizing. Be concise and data-driven.

Definitions:
- CM1 = Net Sales - COGS - Variable Costs. CM2 = CM1 - Ad Spend. CM3 = CM2 - Fixed Costs.
- Net Profit = CM3 - Founder Salary. Blended ROAS = Net Sales / Ad Spend.
- RTO = return-to-origin (failed delivery). CAC = Customer Acquisition Cost.
- Payback = months for cohort to recoup CAC.

`

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await context.params

  let body: { messages?: { role: string; content: string }[]; model?: string; days?: number; stream?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const messages = body.messages ?? []
  const model = body.model || DEFAULT_MODEL
  const days = body.days || 30
  const stream = body.stream !== false // default true

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
    const periodNote = `Data period: ${aiContext.period.from} to ${aiContext.period.to} (${aiContext.period.days} days). Today's data is included.\n\n`
    const systemContent = CHAT_SYSTEM_PREFIX + '══ WORKSPACE METRICS ══\n\n' + periodNote + contextText

    const ollamaMessages = [
      { role: 'system' as const, content: systemContent },
      ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ]

    if (stream) {
      const streamGen = ollamaChatStream({ model, messages: ollamaMessages })

      const encoder = new TextEncoder()
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamGen) {
              controller.enqueue(encoder.encode(JSON.stringify({ content: chunk }) + '\n'))
            }
            controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'))
            controller.close()
          } catch (err) {
            controller.enqueue(
              encoder.encode(JSON.stringify({ error: err instanceof Error ? err.message : 'Stream error' }) + '\n')
            )
            controller.close()
          }
        },
      })

      return new Response(readable, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    // Non-streaming
    const { message, model: usedModel } = await ollamaChat({
      model,
      messages: ollamaMessages,
      stream: false,
    })

    return NextResponse.json({
      reply: message.content,
      modelUsed: usedModel,
      period: aiContext.period,
    })
  } catch (err) {
    console.error('[ai-2/chat] Error:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Internal error',
    }, { status: 500 })
  }
}
