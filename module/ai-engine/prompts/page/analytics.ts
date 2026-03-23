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
 * Builds the analytics-specific user prompt from pre-analyzed data.
 * Designed to stay under ~900 tokens total.
 */
export function buildAnalyticsPrompt(
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

  // Section 1: Current period summary (compact)
  const summaryBlock = [
    `Revenue: ${fmtNum(s.totalNetSales)} (gross: ${fmtNum(s.totalGrossSales)})`,
    `Orders: ${fmtNum(s.totalOrders)} | AOV: ${fmtNum(s.avgAov)}`,
    `COGS: ${fmtNum(s.totalCogs)} | Material Margin: ${fmtNum(s.materialMargin)} (${fmtPct(s.materialMarginPct)})`,
    `Variable Costs — Shipping: ${fmtNum(s.totalShipping)} | Packaging: ${fmtNum(s.totalPackaging)} | Website: ${fmtNum(s.totalWebsiteCharges)}`,
    `CM1: ${fmtNum(s.cm1)} (${fmtPct(s.cm1Pct)}) | CM2: ${fmtNum(s.cm2)} (${fmtPct(s.cm2Pct)}) | CM3: ${fmtNum(s.cm3)} (${fmtPct(s.cm3Pct)})`,
    `Ad Spend: ${fmtNum(s.totalAdSpend)} (Meta: ${fmtNum(s.metaAdSpend)}, Google: ${fmtNum(s.googleAdSpend)})`,
    `MER: ${fmtNum(s.mer)} | ACOS: ${fmtPct(s.acos)}`,
    s.totalSessions != null ? `Sessions: ${fmtNum(s.totalSessions)} | CVR: ${fmtPct(s.conversionRate != null ? s.conversionRate * 100 : null)}` : null,
    s.prepaidPercentage != null ? `Prepaid: ${fmtPct(s.prepaidPercentage)}` : null,
    s.rtoPercent != null ? `RTO: ${fmtPct(s.rtoPercent)} (${fmtNum(s.rtoOrders)} orders, value: ${fmtNum(s.rtoValue)})` : null,
  ].filter(Boolean).join('\n')

  // Section 2: Period-over-period changes
  const comparisonLines = Object.entries(comparison)
    .filter(([, v]) => v.changePercent !== null)
    .map(([key, v]) => `${key}: ${fmtNum(v.current)} vs ${fmtNum(v.prior)} (${fmtPct(v.changePercent)})`)
    .join('\n')

  // Section 3: Anomalies
  const anomalyLines = anomalies.length > 0
    ? anomalies.map(a =>
        `${a.date}: ${a.metric} = ${fmtNum(a.value)} (z-score: ${a.zScore}, ${a.direction})`
      ).join('\n')
    : 'No significant anomalies detected.'

  // Section 4: Trends
  const trendLines = trends.length > 0
    ? trends.map(t =>
        `${t.metric}: ${t.direction} (${fmtPct(t.velocity)}/day, R²: ${t.consistency})`
      ).join('\n')
    : 'No clear trends detected.'

  // Section 5: Daily data (compact pipe-delimited table)
  const dailyHeader = 'date|netSales|orders|aov|cogs|adSpend|cm1|cm2'
  const dailyDataLines = daily.map(d =>
    `${d.date}|${d.netSales}|${d.ordersCount}|${d.aov}|${d.cogs}|${d.adSpend}|${d.cm1}|${d.cm2}`
  ).join('\n')

  const requestedDays = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const actualDays = daily.length
  const lastAvailableDate = daily.length > 0 ? daily[daily.length - 1].date : 'none'
  const coverageNote = actualDays < requestedDays
    ? `Data coverage: ${actualDays} of ${requestedDays} requested days have data. Last available: ${lastAvailableDate}. Recent days may be missing due to Shopify's 24-48h reporting delay.`
    : `Data coverage: ${actualDays} days.`

  // Section 6: Workspace goals (if set)
  const goals = context.goals
  const goalsBlock = goals && goals.length > 0
    ? goals.map(g => {
        const varStr = g.variancePct != null ? ` (${fmtPct(g.variancePct)} vs goal)` : ''
        return `${g.label}: actual ${fmtNum(g.actual)} vs goal ${fmtNum(g.goal)}${varStr} [${g.rag.toUpperCase()}]`
      }).join('\n')
    : null

  return `${coverageNote}

## Analytics Overview: ${fromStr} to ${toStr}
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

### Daily Data
${dailyHeader}
${dailyDataLines}

Analyze this data and respond with a JSON object containing 3-5 actionable insights. Follow the output format specified in the system prompt exactly.${goalsBlock ? ' Pay special attention to metrics that are RED or AMBER vs their workspace goals — these are the user\'s own targets and matter more than industry benchmarks.' : ''}`
}
