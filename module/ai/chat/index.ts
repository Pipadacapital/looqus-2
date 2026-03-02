import type { WorkspaceMetricsContext } from '../types'
import type { PipelineSignals } from '../pipeline/types'
import { buildChatSystemMessage } from '../prompts/chat'
import { ollamaChat, ollamaChatStream, type OllamaChatMessage } from '../providers/ollama'

const DEFAULT_MODEL = process.env.OLLAMA_INSIGHTS_MODEL ?? 'llama3.2'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type ChatWithContextOptions = {
  model?: string
  stream?: boolean
  signals?: PipelineSignals | null
}

export type ChatWithContextResult =
  | { reply: string; modelUsed: string; stream?: false }
  | { reply: null; modelUsed: string; stream: true; streamGenerator: AsyncGenerator<string> }

/**
 * Chat with workspace metrics context. Optionally include pre-computed signals (anomalies, spikes, drops, trends).
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
