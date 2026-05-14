import type { DailyMetricRow, WorkspaceMetricsSummary } from '../types'
import type { PipelineSignals, SignalAnomaly, SignalSpike, SignalDrop, SignalTrend } from './types'

const SPIKE_DROP_PCT_THRESHOLD = 25
const ANOMALY_Z_THRESHOLD = 2
const MIN_DAYS_FOR_ANOMALY = 5

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const variance = arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

/**
 * Detect anomalies: days where a metric is > Z_THRESHOLD standard deviations from the period mean.
 */
function detectAnomalies(
  daily: DailyMetricRow[],
  metricKey: keyof DailyMetricRow,
  label: string,
  getValue: (d: DailyMetricRow) => number
): SignalAnomaly[] {
  if (daily.length < MIN_DAYS_FOR_ANOMALY) return []
  const values = daily.map(getValue).filter((v) => typeof v === 'number' && !Number.isNaN(v))
  if (values.length < MIN_DAYS_FOR_ANOMALY) return []
  const results: SignalAnomaly[] = []
  const avg = mean(values)
  const s = std(values)
  if (s === 0) return []
  daily.forEach((d, i) => {
    const v = getValue(d)
    if (typeof v !== 'number' || Number.isNaN(v)) return
    const z = (v - avg) / s
    if (Math.abs(z) >= ANOMALY_Z_THRESHOLD) {
      results.push({
        type: 'anomaly',
        metric: label,
        date: d.date,
        value: v,
        expectedOrAverage: avg,
        deviation: Math.round(z * 100) / 100,
        direction: z > 0 ? 'high' : 'low',
        description: `${label} ${z > 0 ? 'high' : 'low'} on ${d.date}: ${v.toFixed(0)} (avg ${avg.toFixed(0)}, z=${z.toFixed(2)})`,
      })
    }
  })
  return results
}

/**
 * Detect spikes and drops: day-over-day % change beyond threshold.
 */
function detectSpikesAndDrops(
  daily: DailyMetricRow[],
  metricKey: keyof DailyMetricRow,
  label: string,
  getValue: (d: DailyMetricRow) => number
): { spikes: SignalSpike[]; drops: SignalDrop[] } {
  const spikes: SignalSpike[] = []
  const drops: SignalDrop[] = []
  for (let i = 1; i < daily.length; i++) {
    const curr = getValue(daily[i])
    const prev = getValue(daily[i - 1])
    if (typeof curr !== 'number' || typeof prev !== 'number' || prev === 0) continue
    const pctChange = ((curr - prev) / prev) * 100
    if (pctChange >= SPIKE_DROP_PCT_THRESHOLD) {
      spikes.push({
        type: 'spike',
        metric: label,
        date: daily[i].date,
        value: curr,
        priorValue: prev,
        pctChange: Math.round(pctChange * 10) / 10,
        description: `${label} spiked ${pctChange.toFixed(1)}% on ${daily[i].date} (${curr.toFixed(0)} vs ${prev.toFixed(0)})`,
      })
    } else if (pctChange <= -SPIKE_DROP_PCT_THRESHOLD) {
      drops.push({
        type: 'drop',
        metric: label,
        date: daily[i].date,
        value: curr,
        priorValue: prev,
        pctChange: Math.round(pctChange * 10) / 10,
        description: `${label} dropped ${Math.abs(pctChange).toFixed(1)}% on ${daily[i].date} (${curr.toFixed(0)} vs ${prev.toFixed(0)})`,
      })
    }
  }
  return { spikes, drops }
}

/**
 * Compute period-over-period trends (current vs prior half or prior same-length window).
 */
function detectTrends(
  daily: DailyMetricRow[],
  summary: WorkspaceMetricsSummary | null,
  priorSummary: WorkspaceMetricsSummary | null
): SignalTrend[] {
  const trends: SignalTrend[] = []
  if (!summary || !priorSummary) return trends

  const pairs: { label: string; curr: number; prev: number }[] = [
    { label: 'Net sales', curr: summary.totalNetSales, prev: priorSummary.totalNetSales },
    { label: 'Orders', curr: summary.totalOrders, prev: priorSummary.totalOrders },
    { label: 'AOV', curr: summary.avgAov, prev: priorSummary.avgAov },
    { label: 'Ad spend', curr: summary.totalAdSpend, prev: priorSummary.totalAdSpend },
    { label: 'CM2', curr: summary.cm2, prev: priorSummary.cm2 },
    { label: 'CM3', curr: summary.cm3, prev: priorSummary.cm3 },
  ]

  for (const { label, curr, prev } of pairs) {
    if (prev === 0) continue
    const pctChange = ((curr - prev) / prev) * 100
    const direction: 'up' | 'down' | 'flat' = pctChange > 5 ? 'up' : pctChange < -5 ? 'down' : 'flat'
    trends.push({
      type: 'trend',
      metric: label,
      direction,
      pctChange: Math.round(pctChange * 10) / 10,
      currentPeriodValue: curr,
      priorPeriodValue: prev,
      description: `${label} ${direction} ${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}% vs prior period`,
    })
  }

  if (summary.blendedRoas != null && priorSummary.blendedRoas != null && priorSummary.blendedRoas !== 0) {
    const pctChange = ((summary.blendedRoas - priorSummary.blendedRoas) / priorSummary.blendedRoas) * 100
    const direction: 'up' | 'down' | 'flat' = pctChange > 5 ? 'up' : pctChange < -5 ? 'down' : 'flat'
    trends.push({
      type: 'trend',
      metric: 'Blended ROAS',
      direction,
      pctChange: Math.round(pctChange * 10) / 10,
      currentPeriodValue: summary.blendedRoas,
      priorPeriodValue: priorSummary.blendedRoas,
      description: `Blended ROAS ${direction} ${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}% vs prior period`,
    })
  }
  return trends
}

/**
 * Compute all signals from daily metrics and optional prior-period summary.
 */
export function computeSignals(
  daily: DailyMetricRow[],
  summary: WorkspaceMetricsSummary | null,
  priorSummary: WorkspaceMetricsSummary | null
): PipelineSignals {
  const anomalies: SignalAnomaly[] = []
  const allSpikes: SignalSpike[] = []
  const allDrops: SignalDrop[] = []

  const metricsToCheck: { key: keyof DailyMetricRow; label: string; get: (d: DailyMetricRow) => number }[] = [
    { key: 'netSales', label: 'Net sales', get: (d) => d.netSales },
    { key: 'ordersCount', label: 'Orders', get: (d) => d.ordersCount },
    { key: 'totalAdSpend', label: 'Ad spend', get: (d) => d.totalAdSpend },
    { key: 'cm2', label: 'CM2', get: (d) => d.cm2 },
    { key: 'cm3', label: 'CM3', get: (d) => d.cm3 },
  ]

  if (daily.some((d) => d.rtoPercent != null)) {
    metricsToCheck.push({
      key: 'rtoPercent',
      label: 'RTO %',
      get: (d) => d.rtoPercent ?? 0,
    })
  }

  for (const { key, label, get } of metricsToCheck) {
    anomalies.push(...detectAnomalies(daily, key, label, get))
    const { spikes, drops } = detectSpikesAndDrops(daily, key, label, get)
    allSpikes.push(...spikes)
    allDrops.push(...drops)
  }

  const trends = detectTrends(daily, summary, priorSummary)

  return {
    anomalies,
    spikes: allSpikes,
    drops: allDrops,
    trends,
  }
}
