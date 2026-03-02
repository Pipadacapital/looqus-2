import type { PrismaClient } from '@prisma/client'
import type { WorkspaceMetricsContext } from '../types'
import { loadWorkspaceMetricsFromDb } from './from-db'

/**
 * Build AI context from workspace_daily_metrics for the given range.
 * Use this for insights and chat.
 */
export async function buildWorkspaceContext(
  prisma: PrismaClient,
  workspaceId: string,
  from: Date,
  to: Date
): Promise<WorkspaceMetricsContext> {
  return loadWorkspaceMetricsFromDb(prisma, workspaceId, from, to)
}

export { loadWorkspaceMetricsFromDb } from './from-db'
