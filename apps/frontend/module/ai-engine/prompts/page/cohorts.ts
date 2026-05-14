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
 * Builds the cohort-specific user prompt.
 * Cohort data is structured differently: rows are months, not days.
 * Focus areas: retention quality, payback speed, cohort profitability evolution.
 */
export function buildCohortsPrompt(
  context: PageContext,
  comparison: PeriodComparison,
  anomalies: Anomaly[],
  trends: TrendResult[]
): string {
  const { summary, daily: cohortRows, dateRange, priorDateRange } = context
  const fromStr = dateRange.from.toISOString().slice(0, 10)
  const toStr = dateRange.to.toISOString().slice(0, 10)
  const priorFromStr = priorDateRange.from.toISOString().slice(0, 10)
  const priorToStr = priorDateRange.to.toISOString().slice(0, 10)

  const s = summary as Record<string, number | null>

  const coverageNote = `Cohort data: ${cohortRows.length} monthly cohorts analyzed.`

  const summaryBlock = [
    `Total New Customers: ${fmtNum(s.newCustomers)}`,
    `Average CAC: ${fmtNum(s.averageCac)}`,
    `Average 90-Day Repeat Rate: ${fmtNum(s.avg90DayRepeat)}%`,
    `Average Payback: ${s.averagePayback != null ? `${s.averagePayback.toFixed(1)} months` : 'Not reached within 12 months'}`,
    `Number of Cohorts: ${fmtNum(s.cohortCount)}`,
  ].join('\n')

  // Period comparison
  const comparisonLines = Object.entries(comparison)
    .filter(([, v]) => v.changePercent !== null)
    .map(([key, v]) => `${key}: ${fmtNum(v.current)} vs ${fmtNum(v.prior)} (${fmtPct(v.changePercent)})`)
    .join('\n')

  // Trends on cohort-level metrics (CAC, RR90, payback over monthly cohorts)
  const trendLines = trends.length > 0
    ? trends.map(t =>
        `${t.metric}: ${t.direction} (${fmtPct(t.velocity)}/cohort, R²: ${t.consistency})`
      ).join('\n')
    : 'No clear trends across cohorts.'

  // Anomalies
  const anomalyLines = anomalies.length > 0
    ? anomalies.map(a =>
        `${a.date}: ${a.metric} = ${fmtNum(a.value)} (z-score: ${a.zScore}, ${a.direction})`
      ).join('\n')
    : 'No significant anomalies detected.'

  // Cohort table — one row per month
  // Fields: cohortMonth, nc (new customers), cac, rr90%, payback, firstOrder CM3,
  //         cm3M3/M6/M12 (cumulative CM3 at 3/6/12 month marks), repeatM3/M6 (cumulative repeat %)
  const header = 'month|nc|cac|rr90%|payback|firstOrderCM3|cm3@M3|cm3@M6|cm3@M12|repeat@M3%|repeat@M6%'
  const rows = cohortRows.map(r => {
    const payback = r.payback === -1 ? 'N/R' : String(r.payback)
    return `${r.date}|${r.nc}|${r.cac}|${r.rr90}|${payback}|${r.firstOrder}|${r.cm3M3}|${r.cm3M6}|${r.cm3M12}|${r.repeatM3}|${r.repeatM6}`
  }).join('\n')

  return `${coverageNote}

## Cohort Analysis: ${fromStr} to ${toStr}
Compared against prior period: ${priorFromStr} to ${priorToStr}

### Aggregate Summary
${summaryBlock}

### Period-over-Period Changes (current vs prior aggregate)
${comparisonLines || 'No prior period data available for comparison.'}

### Trends Across Cohorts (older → newer)
${trendLines}

### Anomalies
${anomalyLines}

### Cohort Data (one row per monthly cohort, CM3 cumulative mode)
${header}
${rows}

Key columns explained:
- nc = new customers acquired that month
- cac = cost to acquire one customer (ad spend / nc)
- rr90% = % who repurchased within 90 days
- payback = months until cumulative CM3 covers CAC (N/R = not reached in 12 months)
- firstOrderCM3 = average CM3 from the first order (after refunds)
- cm3@M3/M6/M12 = cumulative per-customer CM3 at 3, 6, and 12 months post-acquisition
- repeat@M3/M6% = cumulative repeat rate at 3 and 6 months

Analyze this cohort data and respond with a JSON object containing 3-5 actionable insights. Focus on:
- Are newer cohorts healthier or weaker than older ones? (CAC trend, RR90 trend, payback trend)
- Payback speed: Which cohorts pay back fastest? Is it getting better or worse?
- Retention quality: Are repeat rates improving or declining across cohorts?
- First order profitability: Is firstOrderCM3 positive? If negative, how many months to break even?
- LTV trajectory: Is cm3@M12 growing across cohorts? Any cohort that never pays back?
Follow the output format specified in the system prompt exactly.`
}
