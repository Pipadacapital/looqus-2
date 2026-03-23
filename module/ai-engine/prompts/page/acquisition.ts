import type { PageContext } from '../../context-adapters/types'
import type { PeriodComparison } from '../../analysis/comparator'
import type { Anomaly } from '../../analysis/anomaly'
import type { TrendResult } from '../../analysis/trend'

function fmtNum(val: number | null | undefined): string {
  if (val == null) return 'N/A'
  return val.toLocaleString('en-IN', { maximumFractionDigits: 1 })
}

function fmtPct(val: number | null | undefined): string {
  if (val == null) return 'N/A'
  const sign = val > 0 ? '+' : ''
  return `${sign}${val.toFixed(1)}%`
}

/**
 * Builds the acquisition-specific user prompt from pre-analyzed data.
 * Focused on: new customer acquisition cost, efficiency, and volume.
 */
export function buildAcquisitionPrompt(
  context: PageContext,
  comparison: PeriodComparison,
  anomalies: Anomaly[],
  trends: TrendResult[]
): string {
  const { summary, daily, dateRange, priorDateRange } = context
  const fromStr = dateRange.from.toISOString().slice(0, 10)
  const toStr = dateRange.to.toISOString().slice(0, 10)
  const priorFromStr = priorDateRange.from.toISOString().slice(0, 10)
  const priorToStr = priorDateRange.to.toISOString().slice(0, 10)

  const s = summary as Record<string, number | null>

  // Data coverage
  const requestedDays = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const actualDays = daily.length
  const lastAvailableDate = daily.length > 0 ? daily[daily.length - 1].date : 'none'
  const coverageNote = actualDays < requestedDays
    ? `Data coverage: ${actualDays} of ${requestedDays} requested days have data. Last available: ${lastAvailableDate}.`
    : `Data coverage: ${actualDays} days.`

  // Summary block
  const summaryBlock = [
    `New Customers: ${fmtNum(s.newCustomers)}`,
    `NC CM2 (new customer contribution margin): ${fmtNum(s.ncCm2)}`,
    `CM2 per NC: ${fmtNum(s.cm2PerNc)}`,
    `Total Ad Spend: ${fmtNum(s.totalAdSpend)} (Meta: ${fmtNum(s.metaAdSpend)}, Google: ${fmtNum(s.googleAdSpend)})`,
    `Blended CAC: ${fmtNum(s.blendedCac)}`,
    `MER: ${fmtNum(s.mer)} | aMER: ${fmtNum(s.aMer)} | ACOS: ${fmtPct(s.acos)}`,
  ].join('\n')

  // Period comparison
  const comparisonLines = Object.entries(comparison)
    .filter(([, v]) => v.changePercent !== null)
    .map(([key, v]) => `${key}: ${fmtNum(v.current)} vs ${fmtNum(v.prior)} (${fmtPct(v.changePercent)})`)
    .join('\n')

  // Anomalies
  const anomalyLines = anomalies.length > 0
    ? anomalies.map(a =>
        `${a.date}: ${a.metric} = ${fmtNum(a.value)} (z-score: ${a.zScore}, ${a.direction})`
      ).join('\n')
    : 'No significant anomalies detected.'

  // Trends
  const trendLines = trends.length > 0
    ? trends.map(t =>
        `${t.metric}: ${t.direction} (${fmtPct(t.velocity)}/day, R²: ${t.consistency})`
      ).join('\n')
    : 'No clear trends detected.'

  // Daily data
  const dailyHeader = 'date|ncCm2|adSpend|newCustomers|blendedCac|ncRevenue|aMer'
  const dailyDataLines = daily.map(d =>
    `${d.date}|${d.ncCm2}|${d.adSpend}|${d.newCustomers}|${d.blendedCac}|${d.ncRevenue}|${d.aMer}`
  ).join('\n')

  // Goals
  const goals = context.goals
  const goalsBlock = goals && goals.length > 0
    ? goals.map(g => {
        const varStr = g.variancePct != null ? ` (${fmtPct(g.variancePct)} vs goal)` : ''
        return `${g.label}: actual ${fmtNum(g.actual)} vs goal ${fmtNum(g.goal)}${varStr} [${g.rag.toUpperCase()}]`
      }).join('\n')
    : null

  return `${coverageNote}

## Customer Acquisition Analysis: ${fromStr} to ${toStr}
Compared against prior period: ${priorFromStr} to ${priorToStr}

### Current Period Summary
${summaryBlock}
${goalsBlock ? `\n### Workspace Goals (user-defined targets)\n${goalsBlock}` : ''}

### Period-over-Period Changes
${comparisonLines || 'No prior period data available for comparison.'}

### Statistical Anomalies
${anomalyLines}

### Trends (over ${daily.length} days)
${trendLines}

### Daily Acquisition Data
${dailyHeader}
${dailyDataLines}

Analyze this acquisition data and respond with a JSON object containing 3-5 actionable insights. Focus on:
- Customer acquisition cost efficiency: Is CAC rising or falling? Is it sustainable vs CM2 per NC?
- MER vs aMER gap: If aMER is much lower than MER, acquisition spend is less efficient than overall
- Channel mix: Meta vs Google spend allocation and relative efficiency
- NC volume trend: Are we acquiring more or fewer new customers over time?
- Unit economics: Is CM2 per NC positive? Is each new customer profitable after ad spend?
Follow the output format specified in the system prompt exactly.${goalsBlock ? ' Pay special attention to metrics that are RED or AMBER vs their workspace goals.' : ''}`
}
