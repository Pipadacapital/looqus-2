import type { PeriodComparison } from '../../analysis/comparator'
import type { Anomaly } from '../../analysis/anomaly'
import type { TrendResult } from '../../analysis/trend'

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—'
  return n.toFixed(decimals)
}

function pctChange(comparison: PeriodComparison, key: string): string {
  const c = comparison[key]
  if (!c || c.changePercent == null) return ''
  const arrow = c.changePercent >= 0 ? '▲' : '▼'
  return ` (${arrow}${Math.abs(c.changePercent).toFixed(1)}% vs prior)`
}

export function buildCodPrepaidPrompt(
  context: any,
  comparison: PeriodComparison,
  anomalies: Anomaly[],
  trends: TrendResult[]
): string {
  const s = context.summary as Record<string, number | null>
  const p = context.priorSummary as Record<string, number | null>
  const breakEvenNote = context.extra?.breakEvenNote as string | null
  const fees = context.extra?.feesUsed as { codFeePerOrder: number; gatewayFeePercent: number; returnShippingPerRto: number } | null

  const from = context.dateRange.from instanceof Date
    ? context.dateRange.from.toISOString().slice(0, 10)
    : String(context.dateRange.from).slice(0, 10)
  const to = context.dateRange.to instanceof Date
    ? context.dateRange.to.toISOString().slice(0, 10)
    : String(context.dateRange.to).slice(0, 10)

  const lines: string[] = []

  lines.push(`## COD vs Prepaid Analytics: ${from} to ${to}`)
  lines.push(`Data: ${context.daily.length} days. Fee assumptions: COD fee ₹${fees?.codFeePerOrder ?? 30}/order, gateway ${fees?.gatewayFeePercent ?? 2}% of prepaid, return shipping ₹${fees?.returnShippingPerRto ?? 80}/RTO.\n`)

  // --- Volume Split ---
  lines.push('### Order Volume Split')
  lines.push(`- Total orders: ${fmt(s.totalOrders)}`)
  lines.push(`- COD: ${fmt(s.codOrders)} (${fmt(s.codPercent, 1)}% of orders)${pctChange(comparison, 'codPercent')}`)
  lines.push(`- Prepaid: ${fmt(s.prepaidOrders)} (${fmt(100 - (s.codPercent ?? 0), 1)}%)`)
  lines.push(`- Average order value: ₹${fmt(s.averageOrderValue, 0)}`)
  lines.push('')

  if (p.totalOrders != null && p.totalOrders > 0) {
    lines.push(`Prior period: ${fmt(p.totalOrders)} orders | COD ${fmt(p.codPercent, 1)}% | COD RTO ${fmt(p.codRtoRatePercent, 1)}% | Prepaid RTO ${fmt(p.prepaidRtoRatePercent, 1)}%\n`)
  }

  // --- RTO Rates ---
  lines.push('### RTO Rates by Payment Method')
  lines.push(`- COD RTO rate: ${fmt(s.codRtoRatePercent, 1)}%${pctChange(comparison, 'codRtoRatePercent')} | Realization: ${fmt(s.codRealizationRatePercent, 1)}%`)
  lines.push(`- Prepaid RTO rate: ${fmt(s.prepaidRtoRatePercent, 1)}%${pctChange(comparison, 'prepaidRtoRatePercent')}`)
  lines.push(`- RTO rate gap (COD - Prepaid): ${s.codRtoRatePercent != null && s.prepaidRtoRatePercent != null ? fmt(s.codRtoRatePercent - s.prepaidRtoRatePercent, 1) : '—'}% higher for COD`)
  lines.push('')

  // --- Break-Even Analysis ---
  lines.push('### Break-Even Analysis')
  if (s.breakEvenCodRtoRatePercent != null) {
    const isAboveBreakEven = (s.codRtoRatePercent ?? 0) > s.breakEvenCodRtoRatePercent
    const verdict = isAboveBreakEven
      ? `⚠️ ABOVE break-even — COD is currently less profitable than prepaid`
      : `✓ BELOW break-even — COD is currently profitable vs prepaid`
    lines.push(`- Break-even COD RTO rate: ${fmt(s.breakEvenCodRtoRatePercent, 1)}%`)
    lines.push(`- Current COD RTO rate: ${fmt(s.codRtoRatePercent, 1)}%`)
    lines.push(`- Verdict: ${verdict}`)
    if (isAboveBreakEven) {
      const excessPct = (s.codRtoRatePercent ?? 0) - s.breakEvenCodRtoRatePercent
      lines.push(`- Excess RTO rate: ${excessPct.toFixed(1)}% above break-even`)
    }
  } else if (breakEvenNote) {
    lines.push(`- Break-even: ${breakEvenNote}`)
  }
  lines.push('')

  // --- Revenue Comparison ---
  lines.push('### Effective Revenue Comparison (after RTO losses and fees)')
  lines.push(`- COD: gross ₹${fmt(s.grossRevenueCod)} → effective ₹${fmt(s.effectiveRevenueCod)} | ₹${fmt(s.netRevenuePerOrderCod, 0)}/order`)
  lines.push(`- Prepaid: gross ₹${fmt(s.grossRevenuePrepaid)} → effective ₹${fmt(s.effectiveRevenuePrepaid)} | ₹${fmt(s.netRevenuePerOrderPrepaid, 0)}/order`)
  const perOrderGap = (s.netRevenuePerOrderPrepaid ?? 0) - (s.netRevenuePerOrderCod ?? 0)
  if (perOrderGap !== 0) {
    lines.push(`- Prepaid premium per order: ₹${perOrderGap.toFixed(0)} ${perOrderGap > 0 ? '(prepaid earns more per order)' : '(COD earns more per order)'}`)
  }
  lines.push(`- Total prepaid premium (period): ₹${fmt(s.prepaidPremium)}${pctChange(comparison, 'prepaidPremium')}`)
  lines.push('')

  // --- Anomalies ---
  if (anomalies.length > 0) {
    lines.push('### Detected Anomalies')
    for (const a of anomalies.slice(0, 5)) {
      lines.push(`- ${a.date}: ${a.metric} was ${a.value.toFixed(1)} (${a.zScore > 0 ? 'spike' : 'drop'}, z=${a.zScore.toFixed(1)})`)
    }
    lines.push('')
  }

  // --- Trends ---
  if (trends.length > 0) {
    lines.push('### Metric Trends')
    for (const t of trends) {
      lines.push(`- ${t.metric}: ${t.direction} (velocity ${t.velocity.toFixed(2)}%/day, consistency=${t.consistency.toFixed(2)})`)
    }
    lines.push('')
  }

  // --- Daily Data ---
  lines.push('### Daily Data (recent 30 days)')
  lines.push('date|codOrders|prepaidOrders|codRto|prepaidRto|codRtoRate%|prepaidRtoRate%')
  for (const d of context.daily) {
    lines.push(`${d.date}|${d.codOrders}|${d.prepaidOrders}|${d.codRto}|${d.prepaidRto}|${d.codRtoRate}|${d.prepaidRtoRate}`)
  }
  lines.push('')

  // --- AI Focus Instructions ---
  lines.push(`### Analysis Focus
Generate 5-7 insights covering:
1. **Break-even verdict** — Is the COD RTO rate above or below break-even? Quantify the rupee cost of being above break-even. "At ₹X AOV and X% RTO, each 100 COD orders above break-even costs ₹Y in lost net revenue."
2. **RTO rate trend** — Is COD RTO rate drifting up or down over the period? Flag sustained upward trends as a risk.
3. **COD vs Prepaid net revenue gap** — How much more (or less) does each prepaid order earn vs COD, after fees and returns? Is the gap widening?
4. **Mix shift risk** — Is the COD % increasing? If COD share is rising AND RTO is above break-even, this is a compounding profitability threat.
5. **Prepaid conversion ROI** — "Converting X% of COD orders to prepaid would generate ₹Y additional net revenue per month." Make it concrete with actual numbers.
6. **RTO anomaly dates** — Were there specific days with COD RTO spikes? Identify the pattern.
7. **Strategic recommendation** — Should this brand aggressively push prepaid conversion? What levers (discount, UPI offers, COD fee pass-through) would have the highest ROI at current order volumes?

Be specific. Use rupee amounts and percentages from the data. COD vs Prepaid is a strategic business decision — make the analysis actionable and data-driven.`)

  return lines.join('\n')
}
