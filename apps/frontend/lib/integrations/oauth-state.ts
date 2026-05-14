import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import type { OAuthProvider } from '@prisma/client'

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export function generateState(): string {
  return crypto.randomBytes(32).toString('hex')
}

function hashState(state: string): string {
  return crypto.createHash('sha256').update(state).digest('hex')
}

export async function createOAuthState(params: {
  provider: OAuthProvider
  workspaceId: string
  userId: string
  state: string
  codeVerifier?: string
}) {
  // Clean up expired states for this provider + workspace
  await prisma.oauth_states.deleteMany({
    where: {
      provider: params.provider,
      workspace_id: params.workspaceId,
      expires_at: { lt: new Date() },
    },
  })

  return prisma.oauth_states.create({
    data: {
      provider: params.provider,
      workspace_id: params.workspaceId,
      user_id: params.userId,
      state_hash: hashState(params.state),
      code_verifier: params.codeVerifier ?? null,
      expires_at: new Date(Date.now() + STATE_TTL_MS),
    },
  })
}

export async function validateOAuthState(
  state: string,
  provider: OAuthProvider
) {
  const hash = hashState(state)

  const record = await prisma.oauth_states.findUnique({
    where: { state_hash: hash },
  })

  if (!record) return null
  if (record.provider !== provider) return null
  if (record.expires_at < new Date()) {
    await prisma.oauth_states.delete({ where: { id: record.id } })
    return null
  }

  // Consume the state (one-time use)
  await prisma.oauth_states.delete({ where: { id: record.id } })

  return record
}
