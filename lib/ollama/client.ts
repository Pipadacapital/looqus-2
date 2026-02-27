/**
 * Local Ollama client. Uses Ollama running on your machine (default http://localhost:11434).
 * Set OLLAMA_BASE_URL in .env if Ollama runs elsewhere (e.g. Docker).
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'

export type OllamaGenerateOptions = {
  model: string
  prompt: string
  system?: string
  stream?: boolean
  format?: 'json' | object
}

export type OllamaGenerateResponse = {
  model: string
  response: string
  done: boolean
}

export async function ollamaGenerate(
  options: OllamaGenerateOptions
): Promise<OllamaGenerateResponse> {
  const { model, prompt, system, stream = false, format } = options
  const url = `${OLLAMA_BASE_URL}/api/generate`
  const body: Record<string, unknown> = {
    model,
    prompt,
    stream,
  }
  if (system) body.system = system
  if (format) body.format = format

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ollama error (${res.status}): ${text || res.statusText}`)
  }

  const data = (await res.json()) as OllamaGenerateResponse
  return data
}

/** Stream generation: yields text deltas. Use for ChatGPT-style streaming. */
export async function* ollamaGenerateStream(
  options: Omit<OllamaGenerateOptions, 'stream'>
): AsyncGenerator<string, void, unknown> {
  const { model, prompt, system } = options
  const url = `${OLLAMA_BASE_URL}/api/generate`
  const body: Record<string, unknown> = {
    model,
    prompt,
    stream: true,
  }
  if (system) body.system = system

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
          const data = JSON.parse(line) as { response?: string; done?: boolean }
          if (data.response) yield data.response
        } catch {
          // skip malformed line
        }
      }
    }
    for (const line of buffer.split('\n')) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line) as { response?: string; done?: boolean }
        if (data.response) yield data.response
      } catch {
        // skip
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Check if local Ollama is reachable and the model is available. */
export async function ollamaHealthCheck(model: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`)
    if (!res.ok) return { ok: false, error: `Ollama returned ${res.status}` }
    const data = (await res.json()) as { models?: { name: string }[] }
    const hasModel = data.models?.some((m) => m.name.startsWith(model) || m.name === model)
    if (!hasModel) return { ok: false, error: `Model "${model}" not found. Run: ollama pull ${model}` }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Cannot reach Ollama at ${OLLAMA_BASE_URL}. ${msg}` }
  }
}
