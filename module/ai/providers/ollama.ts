/**
 * Ollama provider for module/ai. Uses OLLAMA_BASE_URL (default http://localhost:11434).
 * No dependency on lib/ollama — self-contained for module/ai.
 */

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434'

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

export type OllamaChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type OllamaChatOptions = {
  model: string
  messages: OllamaChatMessage[]
  stream?: boolean
}

/** Non-streaming chat. Returns full assistant message. */
export async function ollamaChat(
  options: OllamaChatOptions
): Promise<{ message: { content: string }; model: string }> {
  const { model, messages } = options
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ollama error (${res.status}): ${text || res.statusText}`)
  }

  const data = (await res.json()) as { message?: { content?: string }; model?: string }
  return {
    message: { content: data.message?.content?.trim() ?? '' },
    model: data.model ?? model,
  }
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
