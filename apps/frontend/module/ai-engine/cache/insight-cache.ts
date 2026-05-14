import crypto from 'crypto'
import type { PrismaClient } from '@prisma/client'

const DEFAULT_TTL_HOURS = 6

/**
 * Computes a deterministic cache key from insight parameters.
 */
export function computeCacheKey(
  workspaceId: string,
  page: string,
  dateFrom: string,
  dateTo: string,
  filters?: Record<string, unknown>
): string {
  const raw = JSON.stringify({ workspaceId, page, dateFrom, dateTo, filters: filters ?? {} })
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 64)
}

/**
 * Retrieves a cached insight if it exists.
 * Returns the content and whether it has expired (stale but usable).
 */
export async function getCachedInsight(
  prisma: PrismaClient,
  workspaceId: string,
  filtersHash: string
): Promise<{ content: string; isExpired: boolean; metadata: unknown } | null> {
  const row = await prisma.aiInsight.findFirst({
    where: { workspaceId, filtersHash },
    orderBy: { createdAt: 'desc' },
    select: { content: true, expiresAt: true, metadata: true },
  })

  if (!row) return null

  return {
    content: row.content,
    isExpired: row.expiresAt < new Date(),
    metadata: row.metadata,
  }
}

/**
 * Saves a generated insight to the cache.
 * Upserts based on workspaceId + filtersHash to avoid duplicates.
 */
export async function saveInsight(
  prisma: PrismaClient,
  params: {
    workspaceId: string
    page: string
    dateFrom: Date
    dateTo: Date
    filtersHash: string
    content: string
    provider: string
    model: string
    tokensUsed: number
    latencyMs: number
    metadata?: Record<string, unknown>
    ttlHours?: number
    status?: string
  }
): Promise<void> {
  const ttl = params.ttlHours ?? DEFAULT_TTL_HOURS
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000)

  // Delete any existing insight with same hash, then create new
  await prisma.aiInsight.deleteMany({
    where: {
      workspaceId: params.workspaceId,
      filtersHash: params.filtersHash,
    },
  })

  await prisma.aiInsight.create({
    data: {
      workspaceId: params.workspaceId,
      page: params.page,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      filtersHash: params.filtersHash,
      content: params.content,
      provider: params.provider,
      model: params.model,
      tokensUsed: params.tokensUsed,
      latencyMs: params.latencyMs,
      status: params.status ?? 'done',
      metadata: params.metadata ? (params.metadata as any) : undefined,
      expiresAt,
    },
  })
}
