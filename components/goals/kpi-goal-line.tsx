'use client'

import type { GoalEvaluation } from '@/lib/metrics/goals'
import type { GoalMetricId } from '@/lib/metrics/goal-metrics-registry'
import { GOAL_METRIC_REGISTRY } from '@/lib/metrics/goal-metrics-registry'
import { cn } from '@/lib/utils'

function formatGoalNumber(
  metricId: GoalMetricId,
  v: number,
  currency: string
): string {
  const u = GOAL_METRIC_REGISTRY[metricId].unit
  if (u === 'currency') {
    const sym = currency === 'INR' ? '₹' : '$'
    return `${sym}${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  }
  if (u === 'percent') return `${v.toFixed(1)}%`
  if (u === 'ratio') return `${v.toFixed(2)}×`
  return v.toLocaleString('en-IN', { maximumFractionDigits: 1 })
}

export function KpiGoalLine({
  metricId,
  evaluation,
  currency,
  className,
}: {
  metricId: GoalMetricId
  evaluation: GoalEvaluation
  currency: string
  className?: string
}) {
  const rag =
    evaluation.rag === 'green'
      ? 'text-emerald-600 dark:text-emerald-400'
      : evaluation.rag === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400'

  const vp = evaluation.variancePct
  const varStr =
    vp == null
      ? '—'
      : `${vp >= 0 ? '+' : ''}${vp.toFixed(1)}% vs goal`

  return (
    <p className={cn('text-[11px] leading-tight mt-1 space-y-0.5', className)}>
      <span className="text-muted-foreground">
        Goal {formatGoalNumber(metricId, evaluation.goal, currency)}
      </span>
      <span className={cn(' ml-1.5 font-medium', rag)}>· {evaluation.rag}</span>
      <span className="text-muted-foreground block">{varStr}</span>
    </p>
  )
}
