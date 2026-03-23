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
 * Builds the P&L-specific user prompt from pre-analyzed data.
 * Focused on profitability waterfall: Revenue → COGS → CM1 → CM2 → CM3 → Net Profit.
 * Designed to stay under ~1,000 tokens total.
 */
export function buildPnlPrompt(
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

  // Data coverage note
  const requestedDays = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const actualDays = daily.length
  const lastAvailableDate = daily.length > 0 ? daily[daily.length - 1].date : 'none'
  const coverageNote = actualDays < requestedDays
    ? `Data coverage: ${actualDays} of ${requestedDays} requested days have data. Last available: ${lastAvailableDate}. Recent days may be missing due to Shopify's 24-48h reporting delay.`
    : `Data coverage: ${actualDays} days.`

  // P&L waterfall summary
  const netSales = s.totalNetSales ?? 0
  const pctOf = (val: number | null | undefined) =>
    netSales > 0 && val != null ? `${((val / netSales) * 100).toFixed(1)}%` : 'N/A'

  const waterfallBlock = [
    `Gross Sales: ${fmtNum(s.totalGrossSales)}`,
    `Net Sales: ${fmtNum(s.totalNetSales)}`,
    `Refunds: ${fmtNum(s.totalRefunds)}`,
    `Revenue: ${fmtNum(s.totalRevenue)} | Net Revenue: ${fmtNum(s.totalNetRevenue)}`,
    `COGS: ${fmtNum(s.totalCogs)} (${pctOf(s.totalCogs)} of net sales)`,
    `Material Margin: ${fmtNum(s.materialMargin)} (${fmtPct(s.materialMarginPct)})`,
    `Variable Costs: ${fmtNum(s.totalVariableCosts)} (${pctOf(s.totalVariableCosts)})`,
    `CM1: ${fmtNum(s.cm1)} (${fmtPct(s.cm1Pct)})`,
    `Ad Spend: ${fmtNum(s.totalAdSpend)} (Meta: ${fmtNum(s.metaAdSpend)}, Google: ${fmtNum(s.googleAdSpend)}) (${pctOf(s.totalAdSpend)})`,
    `CM2: ${fmtNum(s.cm2)} (${fmtPct(s.cm2Pct)})`,
    `Fixed Costs: ${fmtNum(s.totalFixedCosts)} (${pctOf(s.totalFixedCosts)})`,
    `CM3: ${fmtNum(s.cm3)} (${fmtPct(s.cm3Pct)})`,
    `Founder Salary: ${fmtNum(s.founderSalary)}`,
    `Net Profit: ${fmtNum(s.netProfit)} (${fmtPct(s.netProfitPct)})`,
    `Orders: ${fmtNum(s.totalOrders)}`,
    s.ncNetRevenue != null || s.ecNetRevenue != null
      ? `NC Revenue: ${fmtNum(s.ncNetRevenue)} | EC Revenue: ${fmtNum(s.ecNetRevenue)}`
      : null,
  ].filter(Boolean).join('\n')

  // Period-over-period changes
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

  // Daily data (compact pipe-delimited table)
  const dailyHeader = 'date|netSales|cogs|varCosts|adSpend|cm1|cm2|cm3|netProfit'
  const dailyDataLines = daily.map(d =>
    `${d.date}|${d.netSales}|${d.cogs}|${d.variableCosts}|${d.adSpend}|${d.cm1}|${d.cm2}|${d.cm3}|${d.netProfit}`
  ).join('\n')

  // Goals section
  const goals = context.goals
  const goalsBlock = goals && goals.length > 0
    ? goals.map(g => {
        const varStr = g.variancePct != null ? ` (${fmtPct(g.variancePct)} vs goal)` : ''
        return `${g.label}: actual ${fmtNum(g.actual)} vs goal ${fmtNum(g.goal)}${varStr} [${g.rag.toUpperCase()}]`
      }).join('\n')
    : null

  return `${coverageNote}

## P&L Analysis: ${fromStr} to ${toStr}
Compared against prior period: ${priorFromStr} to ${priorToStr}

### Profitability Waterfall
${waterfallBlock}
${goalsBlock ? `\n### Workspace Goals (user-defined targets)\n${goalsBlock}` : ''}

### Period-over-Period Changes
${comparisonLines || 'No prior period data available for comparison.'}

### Statistical Anomalies
${anomalyLines}

### Trends (over ${daily.length} days)
${trendLines}

### Daily P&L Data
${dailyHeader}
${dailyDataLines}

Analyze this P&L data and respond with a JSON object containing 3-5 actionable insights. Focus on:
- Where margin is being lost in the profitability waterfall (COGS → Material Margin → Variable Costs → CM1 → Ad Spend → CM2 → Fixed Costs → CM3 → Net Profit)
- Which cost category grew fastest relative to revenue vs prior period
- Margin compression or expansion trends (Material Margin %, CM1%, CM2%, CM3%, net profit %)
- Specific cost optimization recommendations
- NC vs EC revenue mix and what it implies about customer acquisition efficiency
Follow the output format specified in the system prompt exactly.${goalsBlock ? ' Pay special attention to metrics that are RED or AMBER vs their workspace goals — these are the user\'s own targets and matter more than industry benchmarks.' : ''}`
}
