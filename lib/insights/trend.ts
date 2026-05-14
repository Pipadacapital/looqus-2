import type { AggregatedMetrics, TrendSummary } from '@/lib/insights/types'

function pctChange(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0
  return Math.round(((current - prior) / prior) * 1000) / 1000
}

/** Compute trend: % change of current period vs prior period (same length). */
export function computeTrend(
  current: AggregatedMetrics,
  prior: AggregatedMetrics
): TrendSummary {
  const trend: TrendSummary = {}
  if (current.meta && prior.meta) {
    trend.meta = {
      spendPctChange: pctChange(current.meta.spend, prior.meta.spend),
      revenuePctChange: pctChange(current.meta.revenue, prior.meta.revenue),
      roasPctChange: pctChange(current.meta.roas, prior.meta.roas),
    }
  }
  if (current.google && prior.google) {
    trend.google = {
      spendPctChange: pctChange(current.google.spend, prior.google.spend),
      conversionValuePctChange: pctChange(
        current.google.conversionValue,
        prior.google.conversionValue
      ),
      roasPctChange: pctChange(current.google.roas, prior.google.roas),
    }
  }
  return trend
}
