import type { WorkspaceMetricsContext, TrendSnapshot } from './types'
import { buildWorkspaceContext } from './context'
import { generateInsights } from './insights'
import type { PrismaClient } from '@prisma/client'

export type { AiInsight, WorkspaceMetricsContext, TrendSnapshot } from './types'
export { buildWorkspaceContext } from './context'
export { generateInsights } from './insights'
export { chatWithContext, chatWithContextAndTools } from './chat'
export { ollamaListModels } from './providers/ollama'
export { computeSignals } from './pipeline/signals'

/**
 * Compute trend (current period vs prior period) from same-window prior metrics.
 * Caller must load prior context and pass both.
 */
export function computeTrendFromContext(
  current: WorkspaceMetricsContext,
  prior: WorkspaceMetricsContext
): TrendSnapshot | null {
  const s0 = current.summary
  const s1 = prior.summary
  if (!s0 || !s1) return null

  const pct = (curr: number, prev: number): number =>
    prev === 0 ? (curr === 0 ? 0 : 100) : ((curr - prev) / prev) * 100

  return {
    netSalesPctChange: pct(s0.totalNetSales, s1.totalNetSales),
    ordersPctChange: pct(s0.totalOrders, s1.totalOrders),
    aovPctChange: pct(s0.avgAov, s1.avgAov),
    adSpendPctChange: pct(s0.totalAdSpend, s1.totalAdSpend),
    blendedRoasPctChange:
      s0.blendedRoas != null && s1.blendedRoas != null && s1.blendedRoas !== 0
        ? ((s0.blendedRoas - s1.blendedRoas) / s1.blendedRoas) * 100
        : null,
    cm2PctChange: pct(s0.cm2, s1.cm2),
    cm3PctChange: pct(s0.cm3, s1.cm3),
  }
}

/**
 * Load context for last N days and optional prior N days (for trend).
 * Uses yesterday as end date so we don't include today (no data yet).
 * Returns priorContext for pipeline signal detection (anomalies, trends).
 */
export async function loadContextWithTrend(
  prisma: PrismaClient,
  workspaceId: string,
  days: number
): Promise<{
  context: WorkspaceMetricsContext
  trend: TrendSnapshot | null
  priorContext: WorkspaceMetricsContext
}> {
  const to = new Date()
  to.setUTCDate(to.getUTCDate() - 1)
  to.setUTCHours(23, 59, 59, 999)
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - days + 1)
  from.setUTCHours(0, 0, 0, 0)

  const context = await buildWorkspaceContext(prisma, workspaceId, from, to)

  const priorTo = new Date(from)
  priorTo.setUTCDate(priorTo.getUTCDate() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo)
  priorFrom.setUTCDate(priorFrom.getUTCDate() - days + 1)
  priorFrom.setUTCHours(0, 0, 0, 0)

  const priorContext = await buildWorkspaceContext(
    prisma,
    workspaceId,
    priorFrom,
    priorTo
  )
  const trend = computeTrendFromContext(context, priorContext)

  return { context, trend, priorContext }
}
