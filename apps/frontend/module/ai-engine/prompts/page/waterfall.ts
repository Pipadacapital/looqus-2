import type { PageContext } from '../../context-adapters/types'
import type { PeriodComparison } from '../../analysis/comparator'
import type { Anomaly } from '../../analysis/anomaly'
import type { TrendResult } from '../../analysis/trend'

const r = (n: number | null | undefined) => (n == null ? 0 : Math.round(n))
const fmt = (n: number | null | undefined) => `₹${r(n).toLocaleString('en-IN')}`
const p = (n: number | null | undefined) => (n == null ? '0.0' : `${n > 0 ? '' : ''}${Number(n).toFixed(1)}`)
const chg = (c: { changePercent: number | null; change: number } | undefined) => {
  if (!c) return ''
  const pctStr = c.changePercent != null ? ` (${c.changePercent > 0 ? '+' : ''}${c.changePercent.toFixed(1)}%)` : ''
  const absStr = c.change !== 0 ? ` ${c.change > 0 ? '+' : ''}${fmt(Math.abs(c.change))}${pctStr}` : ''
  return absStr
}

export function buildWaterfallPrompt(
  ctx: PageContext,
  comparison: PeriodComparison,
  _anomalies: Anomaly[],
  _trends: TrendResult[]
): string {
  const s = ctx.summary
  const ps = ctx.priorSummary
  const extra = ctx.extra as {
    shiprocketBreakdown: { forwardCharges: number; codCharges: number; rtoCharges: number }
    newCustomers: Record<string, number | null>
    returning: Record<string, number | null>
    hasNewVsReturning: boolean
  } | undefined

  const dateStr = `${ctx.dateRange.from.toISOString().slice(0, 10)} to ${ctx.dateRange.to.toISOString().slice(0, 10)}`
  const priorStr = `${ctx.priorDateRange.from.toISOString().slice(0, 10)} to ${ctx.priorDateRange.to.toISOString().slice(0, 10)}`

  const gs = s.grossSales ?? 0
  const priorGs = ps.grossSales ?? 0

  // Build the main waterfall table (current vs prior, with % of gross)
  const row = (label: string, key: string, pctKey: string, isPositive = false) => {
    const cur = s[key] ?? 0
    const curPct = s[pctKey] ?? 0
    const priorVal = ps[key] ?? 0
    const priorPct = ps[pctKey] ?? 0
    const cmp = comparison[key]
    const sign = isPositive ? (cur >= 0 ? '+' : '') : (cur > 0 ? '-' : '')
    const delta = cmp?.changePercent != null ? `${cmp.changePercent > 0 ? '+' : ''}${cmp.changePercent.toFixed(1)}%` : 'N/A'
    return `${label.padEnd(28)} | ${fmt(cur).padStart(12)} (${p(curPct)}%) | ${fmt(priorVal).padStart(12)} (${p(priorPct)}%) | ${delta}`
  }

  const subtotalRow = (label: string, key: string, pctKey: string) => {
    const cur = s[key] ?? 0
    const curPct = s[pctKey] ?? 0
    const priorVal = ps[key] ?? 0
    const priorPct = ps[pctKey] ?? 0
    const cmp = comparison[key]
    const delta = cmp?.changePercent != null ? `${cmp.changePercent > 0 ? '+' : ''}${cmp.changePercent.toFixed(1)}%` : 'N/A'
    return `${'── ' + label.padEnd(26)} | ${fmt(cur).padStart(12)} (${p(curPct)}%) | ${fmt(priorVal).padStart(12)} (${p(priorPct)}%) | ${delta}`
  }

  // New vs Returning comparison
  const nc = extra?.newCustomers ?? {}
  const rc = extra?.returning ?? {}
  const hasSegments = extra?.hasNewVsReturning ?? false

  const segTable = hasSegments
    ? `
═══════════════════════════════════════
NEW CUSTOMERS vs RETURNING CUSTOMERS (current period only)
Metric                      | New Customers              | Returning Customers         | Delta
Gross Sales                 | ${fmt(nc.grossSales)}      | ${fmt(rc.grossSales)}       |
COGS %                      | ${p(nc.cogsPct)}%          | ${p(rc.cogsPct)}%           | ${((nc.cogsPct ?? 0) - (rc.cogsPct ?? 0) > 0 ? '+' : '')}${((nc.cogsPct ?? 0) - (rc.cogsPct ?? 0)).toFixed(1)}pp
Ad Spend %                  | ${p(nc.adSpendPct)}%       | ${p(rc.adSpendPct)}%        | ${((nc.adSpendPct ?? 0) - (rc.adSpendPct ?? 0) > 0 ? '+' : '')}${((nc.adSpendPct ?? 0) - (rc.adSpendPct ?? 0)).toFixed(1)}pp
CM1 %                       | ${p(nc.cm1Pct)}%           | ${p(rc.cm1Pct)}%            | ${((nc.cm1Pct ?? 0) - (rc.cm1Pct ?? 0) > 0 ? '+' : '')}${((nc.cm1Pct ?? 0) - (rc.cm1Pct ?? 0)).toFixed(1)}pp
CM2 %                       | ${p(nc.cm2Pct)}%           | ${p(rc.cm2Pct)}%            | ${((nc.cm2Pct ?? 0) - (rc.cm2Pct ?? 0) > 0 ? '+' : '')}${((nc.cm2Pct ?? 0) - (rc.cm2Pct ?? 0)).toFixed(1)}pp
Net Profit %                | ${p(nc.netProfitPct)}%     | ${p(rc.netProfitPct)}%      | ${((nc.netProfitPct ?? 0) - (rc.netProfitPct ?? 0) > 0 ? '+' : '')}${((nc.netProfitPct ?? 0) - (rc.netProfitPct ?? 0)).toFixed(1)}pp
Discounts %                 | ${p(nc.discountPct)}%      | ${p(rc.discountPct)}%       | ${((nc.discountPct ?? 0) - (rc.discountPct ?? 0) > 0 ? '+' : '')}${((nc.discountPct ?? 0) - (rc.discountPct ?? 0)).toFixed(1)}pp
RTO Cost %                  | ${p(nc.rtoCostPct)}%       | ${p(rc.rtoCostPct)}%        | ${((nc.rtoCostPct ?? 0) - (rc.rtoCostPct ?? 0) > 0 ? '+' : '')}${((nc.rtoCostPct ?? 0) - (rc.rtoCostPct ?? 0)).toFixed(1)}pp
`
    : '\nNew vs Returning segment split: insufficient data (need both segments with orders).\n'

  // Shiprocket shipping breakdown
  const srBreakdown = extra?.shiprocketBreakdown
  const shipBreakdownStr = srBreakdown
    ? `Shipping detail: Forward ${fmt(srBreakdown.forwardCharges)} + COD ${fmt(srBreakdown.codCharges)} = Outbound ${fmt(srBreakdown.forwardCharges + srBreakdown.codCharges)} | RTO charges (booked separately): ${fmt(srBreakdown.rtoCharges)}`
    : 'Shiprocket not connected — shipping/RTO from Shopify data only.'

  // Identify the single biggest cost drag
  const costLines = [
    { name: 'COGS', pct: s.cogsPct ?? 0 },
    { name: 'Ad Spend', pct: s.adSpendPct ?? 0 },
    { name: 'Variable Costs', pct: s.variableCostsPct ?? 0 },
    { name: 'Discounts', pct: s.discountPct ?? 0 },
    { name: 'Shipping', pct: s.shippingPct ?? 0 },
    { name: 'RTO Cost', pct: s.rtoCostPct ?? 0 },
    { name: 'Fixed Cost', pct: s.fixedCostPct ?? 0 },
    { name: 'Refunds', pct: s.refundPct ?? 0 },
    { name: 'Founder Salary', pct: s.founderSalaryPct ?? 0 },
  ].sort((a, b) => b.pct - a.pct)

  const biggestDrags = costLines.slice(0, 3).map(c => `${c.name} (${p(c.pct)}%)`).join(', ')

  return `You are performing a best-in-class financial waterfall analysis for an Indian D2C brand.
This is the COMPLETE profit decomposition — every rupee from Gross Sales to Net Profit is accounted for.

PERIOD: ${dateStr} | PRIOR: ${priorStr}
GROSS SALES: ${fmt(gs)}${chg(comparison.grossSales)} | ORDERS: ${s.ordersCount ?? 'N/A'}${chg(comparison.ordersCount)}

═══════════════════════════════════════
FULL WATERFALL (Current vs Prior period | % of Gross Sales)
Line Item                    | Current                     | Prior                       | Period Δ
═══════════════════════════════════════
${row('Gross Sales', 'grossSales', 'grossSales')}
${row('  − Discounts', 'discounts', 'discountPct')}
${row('  − Refunds', 'refunds', 'refundPct')}
${row('  − Tax', 'tax', 'taxPct')}
${row('  − Shipping (outbound)', 'shipping', 'shippingPct')}
${subtotalRow('Revenue After Tax & Ship', 'revenueAfterTaxShipping', 'revenueAfterTaxShipping')}
${row('  − COGS', 'cogs', 'cogsPct')}
${row('  − Variable Costs', 'variableCosts', 'variableCostsPct')}
${row('  − RTO Cost', 'rtoCost', 'rtoCostPct')}
${subtotalRow('CM1', 'cm1', 'cm1Pct')}
${row('  − Ad Spend', 'adSpend', 'adSpendPct')}
${subtotalRow('CM2', 'cm2', 'cm2Pct')}
${row('  − Fixed Cost', 'fixedCost', 'fixedCostPct')}
${subtotalRow('CM3', 'cm3', 'cm3Pct')}
${row("  − Founder's Salary", 'founderSalary', 'founderSalaryPct')}
${subtotalRow('NET PROFIT', 'netProfit', 'netProfitPct')}

${shipBreakdownStr}

BIGGEST COST DRAGS (ranked by % of gross): ${biggestDrags}
${segTable}

═══════════════════════════════════════
DEFINITIONS (use these precisely in your analysis)
═══════════════════════════════════════
CM1  = Revenue After Tax & Shipping − COGS − Variable Costs − RTO Cost
       → Gross product economics before any marketing spend
CM2  = CM1 − Ad Spend
       → True marketing-adjusted profitability (most important for D2C)
CM3  = CM2 − Fixed Costs (misc expenses)
       → Operational profitability before founder compensation
Net Profit = CM3 − Founder Salary
       → Bottom line

Variable Costs = Shopify website charges (% of gross) + per-order packaging + per-shipment fees
RTO Cost = Shiprocket return-to-origin shipment charges only
Discounts = Shopify discount codes + automatic discounts applied at checkout

Indian D2C benchmarks (use in analysis):
- Healthy discount rate: < 8% of gross | Warning: 10-15% | Critical: > 15%
- Healthy COGS: < 35% for branded goods | < 50% for commodities
- Healthy CM2: > 15% | Good: > 25% | Excellent: > 35%
- Healthy RTO rate cost: < 2% of gross (implies < 15% RTO rate at ₹150 avg charge)
- Net Profit target: > 10% for D2C | > 5% acceptable in growth phase
- Ad Spend (MER basis): < 20% of gross is healthy; > 30% is unsustainable

═══════════════════════════════════════
ANALYSIS INSTRUCTIONS — generate 6-8 insights covering ALL of:
═══════════════════════════════════════

1. PROFIT STRUCTURE DIAGNOSIS
   - Is net profit positive or negative? What is the #1 root cause?
   - Which single cost line, if reduced by 5 percentage points, would have the biggest impact on net profit?
   - Compare CM1 vs CM2 vs CM3 margins to assess if the problem is product economics, marketing, or ops.

2. DISCOUNT LEAKAGE
   - Is the discount rate (${p(s.discountPct)}% of gross) healthy, concerning, or critical?
   - Did discounts increase vs prior period${chg(comparison.discountPct)}? Is it driving volume or just eroding margin?
   - Calculate: if discounts were reduced by 5%, what would gross sales decline be (assume 2:1 elasticity)?

3. REFUND + RTO DRAIN
   - Refund rate: ${p(s.refundPct)}% of gross. RTO cost rate: ${p(s.rtoCostPct)}%.
   - Together these represent "revenue that never materialized" — assess combined impact.
   - Flag if refund + RTO > 5% of gross as a quality/logistics signal.

4. NEW vs RETURNING ECONOMICS (if segment data available)
   ${hasSegments
     ? `- New customers CM2 is ${p(nc.cm2Pct)}% vs returning ${p(rc.cm2Pct)}%. Assess which segment is actually profitable.
   - If new customer CM2 < 10%, acquisition at current ad spend is margin-negative — flag this critically.
   - Recommend: should the brand shift budget toward retaining existing customers or continue acquiring new ones?`
     : '- Segment data unavailable — recommend enabling customer segmentation for deeper analysis.'}

5. COST EFFICIENCY RANKING
   - Rank the top 3 cost lines by % of gross: ${biggestDrags}
   - For each, assess if it's in-line with benchmarks or needs action.
   - Identify any cost that increased disproportionately vs prior period.

6. PATH TO PROFITABILITY (if net profit < 0) OR MARGIN EXPANSION (if profitable)
   - If net profit is negative: Identify the minimum viable changes (specific cost %) to reach breakeven.
   - If profitable: Identify the highest-leverage actions to expand net profit margin by 5pp.
   - Be specific: "Reduce discounts from X% to Y% would add ₹Z to net profit."

7. PERIOD HEALTH CHECK
   - Is the business getting better or worse vs prior period?
   - Identify 1-2 metrics that improved and 1-2 that deteriorated.
   - Flag if CM2 margin compressed by > 3pp vs prior — that's a structural warning.

8. FOUNDER SALARY CONTEXT (if applicable)
   - Founder salary is ${fmt(s.founderSalary)} (${p(s.founderSalaryPct)}% of gross).
   - At what CM3 level does founder salary make sense vs. burden the business?

Be SPECIFIC with numbers. Do not say "increase revenue" — say which lever and by how much.
Flag critical issues (CM2 < 0, net profit < -10% of gross) with 'critical' severity.

Respond ONLY with valid JSON:
{
  "insights": [
    {
      "title": "string (max 8 words, specific — e.g. 'Discounts Consuming 18% of Gross Sales')",
      "severity": "critical|warning|opportunity|positive",
      "confidence": 0-100,
      "summary": "1-2 sentences with the key finding and specific numbers",
      "detail": "3-5 sentences explaining root cause, context, benchmarks, and business impact",
      "recommendation": "2-3 specific, quantified actions with expected impact",
      "metrics": ["Net Profit %", "CM2 %", "Discount Rate", ...]
    }
  ]
}`
}
