import Anthropic from '@anthropic-ai/sdk'
import type { AiProvider, AiModel, AiProviderOptions, AiProviderResult, StreamChunk } from './types'

const SONNET_MODEL = 'claude-sonnet-4-20250514'
const OPUS_MODEL = 'claude-opus-4-20250514'

export class ClaudeProvider implements AiProvider {
  private client: Anthropic
  readonly name = 'claude'

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set')
    }
    this.client = new Anthropic({ apiKey })
  }

  getModels(): AiModel[] {
    return [
      { id: SONNET_MODEL, name: 'Claude Sonnet 4', provider: 'claude', maxOutputTokens: 8192 },
      { id: OPUS_MODEL, name: 'Claude Opus 4', provider: 'claude', maxOutputTokens: 8192 },
    ]
  }

  async generateStream(
    userPrompt: string,
    options?: AiProviderOptions
  ): Promise<AiProviderResult> {
    const model = options?.model ?? SONNET_MODEL
    const maxTokens = options?.maxTokens ?? 4096
    const temperature = options?.temperature ?? 0.3

    const stream = this.client.messages.stream({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: [{ role: 'user', content: userPrompt }],
    })

    const self = this
    async function* toStreamChunks(): AsyncGenerator<StreamChunk> {
      const response = stream.on('text', () => {})

      for await (const event of response) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { delta: event.delta.text }
        }
      }

      const finalMessage = await stream.finalMessage()
      const usage = finalMessage.usage

      yield {
        delta: '',
        done: true,
        ...({ usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } } as any),
      }
    }

    return {
      stream: toStreamChunks(),
      modelUsed: model,
    }
  }
}

export { SONNET_MODEL, OPUS_MODEL }
