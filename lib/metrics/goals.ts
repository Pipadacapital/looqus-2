import type { PrismaClient } from '@prisma/client'
import { startOfMonth, startOfWeek, format } from 'date-fns'
import {
  type GoalMetricId,
  GOAL_METRIC_REGISTRY,
  isGoalMetricId,
} from './goal-metrics-registry'
import type { WorkspaceGoalPeriodType, WorkspaceGoalValueType } from '@prisma/client'

export type GoalRag = 'green' | 'amber' | 'red'

export type GoalEvaluation = {
  metricName: GoalMetricId
  actual: number
  goal: number
  varianceAbs: number
  variancePct: number | null
  rag: GoalRag
  periodType: WorkspaceGoalPeriodType
  periodStart: string
  goalType: WorkspaceGoalValueType
}

/** UTC date anchor for goal period containing refDate */
export function goalPeriodAnchor(
  periodType: WorkspaceGoalPeriodType,
  refDate: Date
): Date {
  const ymd = refDate.toISOString().slice(0, 10)
  const noon = new Date(`${ymd}T12:00:00.000Z`)
  if (periodType === 'DAILY') {
    return new Date(`${ymd}T00:00:00.000Z`)
  }
  if (periodType === 'WEEKLY') {
    const s = startOfWeek(noon, { weekStartsOn: 1 })
    return new Date(`${format(s, 'yyyy-MM-dd')}T00:00:00.000Z`)
  }
  const m = startOfMonth(noon)
  return new Date(`${format(m, 'yyyy-MM-dd')}T00:00:00.000Z`)
}

function higherBetterForGoal(metricId: GoalMetricId, goalType: WorkspaceGoalValueType): boolean {
  if (goalType === 'MINIMUM') return true
  if (goalType === 'MAXIMUM') return false
  return GOAL_METRIC_REGISTRY[metricId].higherBetter
}

export function computeGoalRag(
  actual: number,
  goal: number,
  higherBetter: boolean
): GoalRag {
  if (higherBetter) {
    if (actual >= goal * 0.95) return 'green'
    if (actual >= goal * 0.8) return 'amber'
    return 'red'
  }
  if (actual <= goal * 1.05) return 'green'
  if (actual <= goal * 1.2) return 'amber'
  return 'red'
}

export function evaluateGoalRow(
  metricId: GoalMetricId,
  actual: number,
  goalValue: number,
  goalType: WorkspaceGoalValueType,
  periodType: WorkspaceGoalPeriodType,
  periodStart: Date
): GoalEvaluation {
  const hb = higherBetterForGoal(metricId, goalType)
  const rag = computeGoalRag(actual, goalValue, hb)
  const varianceAbs = actual - goalValue
  const variancePct =
    goalValue !== 0 ? (varianceAbs / Math.abs(goalValue)) * 100 : null
  return {
    metricName: metricId,
    actual,
    goal: goalValue,
    varianceAbs,
    variancePct,
    rag,
    periodType,
    periodStart: periodStart.toISOString().slice(0, 10),
    goalType,
  }
}

type GoalRow = NonNullable<
  Awaited<ReturnType<PrismaClient['workspaceMetricGoal']['findFirst']>>
>

export function buildGoalEvaluations(
  actuals: Partial<Record<GoalMetricId, number | null | undefined>>,
  goalRows: Map<GoalMetricId, GoalRow>
): Partial<Record<GoalMetricId, GoalEvaluation>> {
  const out: Partial<Record<GoalMetricId, GoalEvaluation>> = {}
  for (const key of Object.keys(actuals) as GoalMetricId[]) {
    const actual = actuals[key]
    if (actual == null || Number.isNaN(Number(actual))) continue
    const row = goalRows.get(key)
    if (!row) continue
    if (!isGoalMetricId(key)) continue
    const gv = Number(row.goalValue)
    out[key] = evaluateGoalRow(
      key,
      Number(actual),
      gv,
      row.goalType,
      row.periodType,
      row.periodStart
    )
  }
  return out
}

export async function fetchGoalRowsMap(
  prisma: PrismaClient,
  workspaceId: string,
  metricIds: GoalMetricId[],
  refDate: Date
): Promise<Map<GoalMetricId, GoalRow>> {
  const d = goalPeriodAnchor('DAILY', refDate)
  const w = goalPeriodAnchor('WEEKLY', refDate)
  const m = goalPeriodAnchor('MONTHLY', refDate)
  const rows = await prisma.workspaceMetricGoal.findMany({
    where: {
      workspaceId,
      metricName: { in: metricIds },
      OR: [
        { periodType: 'DAILY', periodStart: d },
        { periodType: 'WEEKLY', periodStart: w },
        { periodType: 'MONTHLY', periodStart: m },
      ],
    },
  })
  const map = new Map<GoalMetricId, GoalRow>()
  for (const name of metricIds) {
    const candidates = rows.filter((r) => r.metricName === name)
    const pick =
      candidates.find((r) => r.periodType === 'DAILY') ??
      candidates.find((r) => r.periodType === 'WEEKLY') ??
      candidates.find((r) => r.periodType === 'MONTHLY')
    if (pick && isGoalMetricId(pick.metricName)) {
      map.set(pick.metricName as GoalMetricId, pick)
    }
  }
  return map
}
