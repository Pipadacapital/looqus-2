import type { PrismaClient } from '@prisma/client'
import { computeAcquisition } from '@/lib/acquisition/compute'
import { fetchGoalRowsMap, buildGoalEvaluations } from '@/lib/metrics/goals'
import { GOAL_METRIC_REGISTRY, type GoalMetricId } from '@/lib/metrics/goal-metrics-registry'
import type { PageContext, DateRange, CompressedDailyRow, GoalContext } from './types'

function computePriorPeriod(from: Date, to: Date): DateRange {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

/**
 * Builds the acquisition context for AI insight generation.
 * Uses computeAcquisition for both current and prior period.
 */
export async function buildAcquisitionContext(
  prisma: PrismaClient,
  workspaceId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<PageContext> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      shopifyConnections: { where: { status: 'CONNECTED' }, select: { id: true }, take: 1 },
      cogsSettings: true,
      meta_ads_connections: {
        select: { id: true, selected_ad_account_ids: true, selected_ad_account_id: true },
      },
      google_ads_connections: {
        select: { id: true, selected_customer_ids: true, selected_customer_id: true },
      },
    },
  })

  const connectionId = workspace.shopifyConnections[0]?.id
  const priorRange = computePriorPeriod(dateFrom, dateTo)

  if (!connectionId) {
    return {
      page: 'acquisition',
      workspaceId,
      dateRange: { from: dateFrom, to: dateTo },
      priorDateRange: priorRange,
      summary: {},
      priorSummary: {},
      daily: [],
      currency: 'INR',
    }
  }

  const fromStr = dateFrom.toISOString().slice(0, 10)
  const toStr = dateTo.toISOString().slice(0, 10)
  const priorFromStr = priorRange.from.toISOString().slice(0, 10)
  const priorToStr = priorRange.to.toISOString().slice(0, 10)

  // Fetch current, prior, and goals in parallel
  const goalMetricIds: GoalMetricId[] = ['mer', 'amer', 'cac', 'new_customers', 'acos']
  const [current, prior, goalRows] = await Promise.all([
    computeAcquisition(prisma, workspace as any, { from: fromStr, to: toStr }),
    computeAcquisition(prisma, workspace as any, { from: priorFromStr, to: priorToStr }),
    fetchGoalRowsMap(prisma, workspaceId, goalMetricIds, dateTo),
  ])

  const cs = current.summary
  const ps = prior.summary
  const me = cs.marketingEfficiency

  // Flatten summary for comparison
  const summary: Record<string, number | null> = {
    newCustomers: cs.newCustomers,
    ncCm2: Math.round(cs.cm2),
    cm2PerNc: cs.cm2PerNc != null ? Math.round(cs.cm2PerNc) : null,
    totalAdSpend: Math.round(cs.totalAdSpend),
    metaAdSpend: Math.round(cs.meta),
    googleAdSpend: Math.round(cs.google),
    blendedCac: cs.blendedCac != null ? Math.round(cs.blendedCac) : null,
    mer: me.mer ?? null,
    aMer: me.aMer ?? null,
    acos: me.acos ?? null,
  }

  const pme = ps.marketingEfficiency
  const priorSummary: Record<string, number | null> = {
    newCustomers: ps.newCustomers,
    ncCm2: Math.round(ps.cm2),
    cm2PerNc: ps.cm2PerNc != null ? Math.round(ps.cm2PerNc) : null,
    totalAdSpend: Math.round(ps.totalAdSpend),
    metaAdSpend: Math.round(ps.meta),
    googleAdSpend: Math.round(ps.google),
    blendedCac: ps.blendedCac != null ? Math.round(ps.blendedCac) : null,
    mer: pme.mer ?? null,
    aMer: pme.aMer ?? null,
    acos: pme.acos ?? null,
  }

  // Compressed daily rows — acquisition-specific fields
  const compressed: CompressedDailyRow[] = current.daily
    .filter(d => d.newCustomers > 0 || d.adSpend > 0)
    .map(d => ({
      date: d.date,
      ncCm2: Math.round(d.ncCm2),
      adSpend: Math.round(d.adSpend),
      newCustomers: d.newCustomers,
      blendedCac: d.blendedCac != null ? Math.round(d.blendedCac) : 0,
      ncRevenue: Math.round(d.ncRevenue),
      aMer: d.aMerDaily != null ? Math.round(d.aMerDaily * 100) / 100 : 0,
    }))

  // Cap daily to last 30 rows
  const cappedDaily = compressed.length > 30 ? compressed.slice(-30) : compressed

  // Evaluate goals
  const goalActuals: Partial<Record<GoalMetricId, number | null>> = {
    mer: summary.mer,
    amer: summary.aMer,
    cac: summary.blendedCac,
    new_customers: summary.newCustomers,
    acos: summary.acos,
  }
  const goalEvals = buildGoalEvaluations(goalActuals, goalRows)
  const goals: GoalContext[] = Object.entries(goalEvals).map(([key, ev]) => ({
    metricName: key,
    label: GOAL_METRIC_REGISTRY[key as GoalMetricId]?.label ?? key,
    goal: ev.goal,
    actual: ev.actual,
    variancePct: ev.variancePct,
    rag: ev.rag,
  }))

  return {
    page: 'acquisition',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary,
    priorSummary,
    daily: cappedDaily,
    currency: current.currency ?? 'INR',
    goals: goals.length > 0 ? goals : undefined,
  }
}
