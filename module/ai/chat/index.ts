import type { WorkspaceMetricsContext } from '../types'
import type { PipelineSignals } from '../pipeline/types'
import { buildChatSystemMessage, buildChatSystemMessageForTools } from '../prompts/chat'
import { ollamaChat, ollamaChatStream, type OllamaChatMessage } from '../providers/ollama'
import { AI_TOOLS, executeTool, type ToolName } from '../tools'
import type { PrismaClient } from '@prisma/client'

const DEFAULT_MODEL = process.env.OLLAMA_INSIGHTS_MODEL ?? 'llama3.2'
const MAX_TOOL_ROUNDS = 5

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type ChatWithContextOptions = {
  model?: string
  stream?: boolean
  signals?: PipelineSignals | null
}

export type ChatWithContextResult =
  | { reply: string; modelUsed: string; stream?: false }
  | { reply: null; modelUsed: string; stream: true; streamGenerator: AsyncGenerator<string> }

export type ChatWithToolsOptions = {
  model?: string
  stream?: boolean
  /** Default period (from loadContextWithTrend) so the model knows "last N days" range */
  defaultPeriod: { from: string; to: string; days: number }
}

/**
 * Chat with tool calling: model can call get_workspace_metrics, get_orders_summary, get_top_products, etc.
 * Runs tool loop (parallel execution) until the model returns a final text reply or max rounds.
 * When stream=true, streams the final reply only (after tools are done).
 */
export async function chatWithContextAndTools(
  prisma: PrismaClient,
  workspaceId: string,
  messages: ChatMessage[],
  options: ChatWithToolsOptions
): Promise<ChatWithContextResult> {
  const model = options.model ?? DEFAULT_MODEL
  const stream = options.stream === true
  const systemContent = buildChatSystemMessageForTools(options.defaultPeriod)

  const ollamaMessages: OllamaChatMessage[] = [
    { role: 'system', content: systemContent },
    ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ]

  let rounds = 0
  let lastContent = ''
  let usedModel = model

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++
    const { message, model: m } = await ollamaChat({
      model: usedModel,
      messages: ollamaMessages,
      stream: false,
      tools: AI_TOOLS,
    })
    usedModel = m
    lastContent = message.content ?? ''

    if (!message.tool_calls?.length) {
      if (stream) {
        const streamGenerator = streamString(lastContent)
        return { reply: null, modelUsed: usedModel, stream: true, streamGenerator }
      }
      return { reply: lastContent, modelUsed: usedModel, stream: false }
    }

    ollamaMessages.push({
      role: 'assistant',
      content: lastContent,
      tool_calls: message.tool_calls,
    })

    const toolResults = await Promise.all(
      message.tool_calls
        .sort((a, b) => a.function.index - b.function.index)
        .map(async (tc) => {
          const name = tc.function.name as ToolName
          const args = tc.function.arguments ?? {}
          try {
            const result = await executeTool(prisma, workspaceId, name, args)
            return { tool_name: name, content: result }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { tool_name: name, content: `Error: ${msg}` }
          }
        })
    )

    for (const tr of toolResults) {
      ollamaMessages.push({ role: 'tool', tool_name: tr.tool_name, content: tr.content })
    }
  }

  if (stream) {
    const streamGenerator = streamString(lastContent || 'I hit the tool call limit. Please try a simpler question.')
    return { reply: null, modelUsed: usedModel, stream: true, streamGenerator }
  }
  return {
    reply: lastContent || 'I hit the tool call limit. Please try a simpler question.',
    modelUsed: usedModel,
    stream: false,
  }
}

async function* streamString(s: string): AsyncGenerator<string> {
  const chunkSize = 4
  for (let i = 0; i < s.length; i += chunkSize) {
    yield s.slice(i, i + chunkSize)
  }
}

/**
 * Chat with workspace metrics context. Optionally include pre-computed signals (anomalies, spikes, drops, trends).
 * Does not use tools; use chatWithContextAndTools for tool calling.
 */
export async function chatWithContext(
  context: WorkspaceMetricsContext,
  messages: ChatMessage[],
  options: ChatWithContextOptions = {}
): Promise<ChatWithContextResult> {
  const model = options.model ?? DEFAULT_MODEL
  const stream = options.stream === true
  const signals = options.signals ?? null

  const systemContent = buildChatSystemMessage(context, signals)
  const ollamaMessages: OllamaChatMessage[] = [
    { role: 'system', content: systemContent },
    ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ]

  if (stream) {
    const streamGenerator = ollamaChatStream({ model, messages: ollamaMessages })
    return { reply: null, modelUsed: model, stream: true, streamGenerator }
  }

  const { message, model: usedModel } = await ollamaChat({
    model,
    messages: ollamaMessages,
    stream: false,
  })
  return { reply: message.content, modelUsed: usedModel, stream: false }
}
