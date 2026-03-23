export type StreamChunk = {
  delta: string
  done?: boolean
}

export type AiModel = {
  id: string
  name: string
  provider: string
  maxOutputTokens: number
}

export type AiProviderOptions = {
  model?: string
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
}

export type AiProviderResult = {
  stream: AsyncGenerator<StreamChunk>
  modelUsed: string
}

export interface AiProvider {
  readonly name: string
  getModels(): AiModel[]
  generateStream(
    userPrompt: string,
    options?: AiProviderOptions
  ): Promise<AiProviderResult>
}
