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
  await prisma.oAuthState.deleteMany({
    where: {
      provider: params.provider,
      workspaceId: params.workspaceId,
      expiresAt: { lt: new Date() },
    },
  })

  return prisma.oAuthState.create({
    data: {
      provider: params.provider,
      workspaceId: params.workspaceId,
      userId: params.userId,
      stateHash: hashState(params.state),
      codeVerifier: params.codeVerifier ?? null,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  })
}

export async function validateOAuthState(
  state: string,
  provider: OAuthProvider
) {
  const hash = hashState(state)

  const record = await prisma.oAuthState.findUnique({
    where: { stateHash: hash },
  })

  if (!record) return null
  if (record.provider !== provider) return null
  if (record.expiresAt < new Date()) {
    await prisma.oAuthState.delete({ where: { id: record.id } })
    return null
  }

  // Consume the state (one-time use)
  await prisma.oAuthState.delete({ where: { id: record.id } })

  return record
}
