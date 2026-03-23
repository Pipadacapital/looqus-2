import { SONNET_MODEL } from '../providers/claude'

export type WorkspaceAiConfig = {
  provider: string
  model: string
  enabled: boolean
}

/**
 * Returns AI configuration for a workspace.
 * Phase 1: returns hardcoded defaults (Claude Sonnet, enabled).
 * Future: read from DB per workspace.
 */
export function getWorkspaceAiConfig(_workspaceId: string): WorkspaceAiConfig {
  return {
    provider: 'claude',
    model: SONNET_MODEL,
    enabled: true,
  }
}
