import type { AiProvider } from './types'
import { ClaudeProvider, SONNET_MODEL, OPUS_MODEL } from './claude'

let cachedProvider: ClaudeProvider | null = null

export function getProvider(): AiProvider {
  if (!cachedProvider) {
    cachedProvider = new ClaudeProvider()
  }
  return cachedProvider
}

export function getDefaultModel(page: string): string {
  if (page === 'global' || page === 'chat') {
    return OPUS_MODEL
  }
  return SONNET_MODEL
}
