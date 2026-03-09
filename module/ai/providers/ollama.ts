import { prisma } from "@/lib/prisma";

/**
 * Ollama provider for module/ai. Uses OLLAMA_BASE_URL (default http://localhost:11434).
 * No dependency on lib/ollama — self-contained for module/ai.
 */
const settings = await prisma.systemSettings.findFirst();
const ollamaUrl = settings?.ollamaUrl;
const OLLAMA_BASE_URL = ollamaUrl ?? 'http://localhost:11434'

export type OllamaGenerateOptions = {
  model: string
  prompt: string
  system?: string
  format?: 'json'
}

export type OllamaGenerateResult = {
  response: string
  model: string
}

export async function ollamaGenerate(
  options: OllamaGenerateOptions
): Promise<OllamaGenerateResult> {
  const { model, prompt, system, format } = options
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      ...(system && { system }),
      ...(format && { format }),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ollama error (${res.status}): ${text || res.statusText}`)
  }

  const data = (await res.json()) as { response?: string; model?: string }
  return {
    response: data.response?.trim() ?? '',
    model: data.model ?? model,
  }
}

/** List available models for the insights model selector. */
export async function ollamaListModels(): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`)
  if (!res.ok) return []
  const data = (await res.json()) as { models?: { name: string }[] }
  return (data.models ?? []).map((m) => ({
    id: m.name,
    name: m.name,
  }))
}

export type OllamaChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | {
      role: 'assistant'
      content: string
      tool_calls?: Array<{
        type: 'function'
        function: { index: number; name: string; arguments: Record<string, unknown> }
      }>
    }
  | { role: 'tool'; tool_name: string; content: string }

export type OllamaChatOptions = {
  model: string
  messages: OllamaChatMessage[]
  stream?: boolean
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }>
}

/** Non-streaming chat. Returns full assistant message. */
export async function ollamaChat(
  options: OllamaChatOptions
): Promise<{
  message: { content: string; tool_calls?: Array<{ type: 'function'; function: { index: number; name: string; arguments: Record<string, unknown> } }> }
  model: string
}> {
  const { model, messages, tools } = options
  const body: Record<string, unknown> = {
    model,
    messages: messages.map(normalizeMessageForSend),
    stream: false,
  }
  if (tools && tools.length > 0) {
    body.tools = JSON.parse(JSON.stringify(tools))
  }
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    let errMsg = `Ollama error (${res.status}): ${text || res.statusText}`
    if (res.status === 400 && body.tools) {
      errMsg += ' Tool calling may require a model that supports it (e.g. qwen3, llama3.1). Try switching the model in the AI Insights dropdown.'
    }
    throw new Error(errMsg)
  }

  const data = (await res.json()) as {
    message?: { content?: string; tool_calls?: Array<{ type: 'function'; function: { index: number; name: string; arguments: string } }> }
    model?: string
  }
  const rawMsg = data.message
  let tool_calls: Array<{ type: 'function'; function: { index: number; name: string; arguments: Record<string, unknown> } }> | undefined
  if (rawMsg?.tool_calls?.length) {
    tool_calls = rawMsg.tool_calls.map((tc) => ({
      type: 'function' as const,
      function: {
        index: tc.function.index,
        name: tc.function.name,
        arguments: (() => {
          try {
            return typeof tc.function.arguments === 'string'
              ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
              : (tc.function.arguments as Record<string, unknown>)
          } catch {
            return {}
          }
        })(),
      },
    }))
  }
  return {
    message: {
      content: rawMsg?.content?.trim() ?? '',
      ...(tool_calls && { tool_calls }),
    },
    model: data.model ?? model,
  }
}

function normalizeMessageForSend(m: OllamaChatMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', tool_name: m.tool_name, content: m.content }
  }
  if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls?.length) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.tool_calls.map((tc) => ({
        type: tc.type,
        function: {
          index: tc.function.index,
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'object' ? JSON.stringify(tc.function.arguments) : tc.function.arguments,
        },
      })),
    }
  }
  return { role: m.role, content: m.content }
}

/** Streaming chat. Yields content deltas. */
export async function* ollamaChatStream(
  options: Omit<OllamaChatOptions, 'stream'>
): AsyncGenerator<string, void, unknown> {
  const { model, messages } = options
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ollama error (${res.status}): ${text || res.statusText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
          if (data.message?.content) yield data.message.content
        } catch {
          // skip
        }
      }
    }
    for (const line of buffer.split('\n')) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line) as { message?: { content?: string } }
        if (data.message?.content) yield data.message.content
      } catch {
        // skip
      }
    }
  } finally {
    reader.releaseLock()
  }
}
