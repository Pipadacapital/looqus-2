import type { PeriodComparison } from '../../analysis/comparator'
import type { Anomaly } from '../../analysis/anomaly'
import type { TrendResult } from '../../analysis/trend'

type PinRow = {
  pincode: string
  city: string
  state: string
  orders: number
  revenue: number
  aov: number | null
  rtoPercent: number | null
  codPercent: number | null
  deliveredPercent: number | null
  repeatRate: number | null
  profitabilityScore: number
  tier: 1 | 2 | 3 | null
  topCourier: string
}

type StateSummary = {
  state: string
  orders: number
  revenue: number
  shipments: number
  rtoPercent: number | null
  codPercent: number | null
  deliveredPercent: number | null
  avgScore: number
  pincodeCount: number
}

type TierSummary = {
  tier: string
  revenue: number
  orders: number
  shipments: number
  rtoPercent: number | null
  codPercent: number | null
  deliveredPercent: number | null
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null || isNaN(n as number)) return '—'
  return (n as number).toFixed(decimals)
}

function inr(n: number | null | undefined): string {
  if (n == null) return '—'
  return `₹${Math.round(n as number).toLocaleString('en-IN')}`
}

function pctChange(comparison: PeriodComparison, key: string): string {
  const c = comparison[key]
  if (!c || c.changePercent == null) return ''
  const arrow = c.changePercent >= 0 ? '▲' : '▼'
  return ` (${arrow}${Math.abs(c.changePercent).toFixed(1)}% vs prior)`
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'moderate'
  if (score >= 20) return 'poor'
  return 'critical'
}

export function buildPincodeIntelligencePrompt(
  context: any,
  comparison: PeriodComparison,
  anomalies: Anomaly[],
  trends: TrendResult[]
): string {
  const s = context.summary as Record<string, number | null>
  const p = context.priorSummary as Record<string, number | null>
  const stateSummaries = (context.extra?.stateSummaries ?? []) as StateSummary[]
  const tierSummaries = (context.extra?.tierSummaries ?? []) as TierSummary[]
  const codKillList = (context.extra?.codKillList ?? []) as PinRow[]
  const topRevenuePincodes = (context.extra?.topRevenuePincodes ?? []) as PinRow[]
  const rtoHotspots = (context.extra?.rtoHotspots ?? []) as PinRow[]
  const loyaltyGems = (context.extra?.loyaltyGems ?? []) as PinRow[]
  const expansionOpps = (context.extra?.expansionOpps ?? []) as PinRow[]
  const problemAreas = (context.extra?.problemAreas ?? []) as PinRow[]

  const from = context.dateRange.from instanceof Date
    ? context.dateRange.from.toISOString().slice(0, 10)
    : String(context.dateRange.from).slice(0, 10)
  const to = context.dateRange.to instanceof Date
    ? context.dateRange.to.toISOString().slice(0, 10)
    : String(context.dateRange.to).slice(0, 10)

  const lines: string[] = []

  lines.push(`## Pincode Intelligence: ${from} to ${to}`)
  lines.push(`Coverage: ${fmt(s.totalPincodes)} unique pincodes | ${fmt(s.totalShipments)} total shipments\n`)

  // --- Portfolio Overview ---
  lines.push('### Geographic Portfolio Overview')
  lines.push(`- Total Revenue (delivered): ${inr(s.totalRevenue)}${pctChange(comparison, 'totalRevenue')}`)
  lines.push(`- Total Orders: ${fmt(s.totalOrders)}${pctChange(comparison, 'totalOrders')}`)
  lines.push(`- Overall RTO Rate: ${fmt(s.avgRtoPercent, 1)}%${pctChange(comparison, 'avgRtoPercent')}`)
  lines.push(`- Overall COD Rate: ${fmt(s.avgCodPercent, 1)}%${pctChange(comparison, 'avgCodPercent')}`)
  lines.push(`- Overall Delivered Rate: ${fmt(s.avgDeliveredPercent, 1)}%${pctChange(comparison, 'avgDeliveredPercent')}`)
  lines.push(`- Avg Profitability Score: ${fmt(s.avgScore, 1)}/100 — ${scoreLabel(s.avgScore ?? 0)}`)
  lines.push(`- High RTO Pincodes (≥20%): ${fmt(s.highRtoPincodes)}${pctChange(comparison, 'highRtoPincodes')}`)
  lines.push(`- High COD Pincodes (≥50%): ${fmt(s.highCodPincodes)}${pctChange(comparison, 'highCodPincodes')}`)
  lines.push('')

  if (p.totalRevenue != null && p.totalRevenue > 0) {
    lines.push(`Prior period: Revenue ${inr(p.totalRevenue)} | RTO ${fmt(p.avgRtoPercent, 1)}% | High-RTO pincodes ${fmt(p.highRtoPincodes)}\n`)
  }

  // --- Tier Revenue Split ---
  if (tierSummaries.length > 0) {
    lines.push('### Revenue by City Tier')
    lines.push('tier | revenue | orders | rto% | cod% | delivered%')
    for (const t of tierSummaries) {
      lines.push(`${t.tier} | ${inr(t.revenue)} | ${t.orders} | ${fmt(t.rtoPercent, 1)}% | ${fmt(t.codPercent, 1)}% | ${fmt(t.deliveredPercent, 1)}%`)
    }
    const totalRevAll = (s.totalRevenue ?? 0) || 1
    const t1Share = Math.round(((s.tier1Revenue ?? 0) / totalRevAll) * 100)
    const t2Share = Math.round(((s.tier2Revenue ?? 0) / totalRevAll) * 100)
    const t3Share = Math.round(((s.tier3Revenue ?? 0) / totalRevAll) * 100)
    lines.push(`Revenue split: T1=${t1Share}% | T2=${t2Share}% | T3=${t3Share}%`)
    lines.push('')
  }

  // --- State-Level Analysis ---
  if (stateSummaries.length > 0) {
    lines.push('### Top States by Revenue')
    lines.push('state | revenue | orders | pincodes | rto% | cod% | delivered% | avg-score')
    for (const st of stateSummaries.slice(0, 8)) {
      lines.push(`${st.state} | ${inr(st.revenue)} | ${st.orders} | ${st.pincodeCount} | ${fmt(st.rtoPercent, 1)}% | ${fmt(st.codPercent, 1)}% | ${fmt(st.deliveredPercent, 1)}% | ${fmt(st.avgScore, 0)}`)
    }
    lines.push('')
  }

  // --- COD Kill List ---
  if (codKillList.length > 0) {
    lines.push('### COD Kill List — Stop COD Here Immediately')
    lines.push('These pincodes have HIGH COD% AND HIGH RTO% — COD is actively destroying margins.')
    lines.push('pincode | city | state | orders | rto% | cod% | delivered% | score | courier')
    for (const r of codKillList) {
      lines.push(`${r.pincode} | ${r.city} | ${r.state} | ${r.orders} | ${fmt(r.rtoPercent, 1)}% | ${fmt(r.codPercent, 1)}% | ${fmt(r.deliveredPercent, 1)}% | ${fmt(r.profitabilityScore, 0)} | ${r.topCourier}`)
    }
    lines.push('')
  } else {
    lines.push('No pincodes with dangerous COD+RTO combination (≥40% COD and ≥20% RTO with 3+ shipments). ✓\n')
  }

  // --- RTO Hotspots ---
  if (rtoHotspots.length > 0) {
    lines.push('### RTO Hotspots (≥20% RTO, ≥5 shipments)')
    lines.push('pincode | city | state | tier | orders | rto% | cod% | score | courier')
    for (const r of rtoHotspots) {
      lines.push(`${r.pincode} | ${r.city} | ${r.state} | T${r.tier ?? '?'} | ${r.orders} | ${fmt(r.rtoPercent, 1)}% | ${fmt(r.codPercent, 1)}% | ${fmt(r.profitabilityScore, 0)} | ${r.topCourier}`)
    }
    lines.push('')
  }

  // --- Top Revenue Pincodes ---
  if (topRevenuePincodes.length > 0) {
    lines.push('### Top Revenue Pincodes')
    lines.push('pincode | city | state | tier | revenue | orders | aov | rto% | delivered% | repeat% | score')
    for (const r of topRevenuePincodes) {
      lines.push(`${r.pincode} | ${r.city} | ${r.state} | T${r.tier ?? '?'} | ${inr(r.revenue)} | ${r.orders} | ${inr(r.aov)} | ${fmt(r.rtoPercent, 1)}% | ${fmt(r.deliveredPercent, 1)}% | ${fmt(r.repeatRate, 1)}% | ${fmt(r.profitabilityScore, 0)}`)
    }
    lines.push('')
  }

  // --- Loyalty Gems ---
  if (loyaltyGems.length > 0) {
    lines.push('### Loyalty Gems (High Repeat Rate, ≥5 orders)')
    lines.push('pincode | city | state | orders | repeat% | revenue | aov | score')
    for (const r of loyaltyGems) {
      lines.push(`${r.pincode} | ${r.city} | ${r.state} | ${r.orders} | ${fmt(r.repeatRate, 1)}% | ${inr(r.revenue)} | ${inr(r.aov)} | ${fmt(r.profitabilityScore, 0)}`)
    }
    lines.push('')
  }

  // --- Expansion Opportunities ---
  if (expansionOpps.length > 0) {
    lines.push('### Expansion Opportunities (T3 cities, score ≥65, underserved)')
    lines.push('pincode | city | state | orders | score | rto% | delivered% | repeat%')
    for (const r of expansionOpps) {
      lines.push(`${r.pincode} | ${r.city} | ${r.state} | ${r.orders} | ${fmt(r.profitabilityScore, 0)} | ${fmt(r.rtoPercent, 1)}% | ${fmt(r.deliveredPercent, 1)}% | ${fmt(r.repeatRate, 1)}%`)
    }
    lines.push('')
  }

  // --- Problem Areas ---
  if (problemAreas.length > 0) {
    lines.push('### Problem Areas (Score <35)')
    lines.push('pincode | city | state | orders | score | rto% | cod% | delivered%')
    for (const r of problemAreas) {
      lines.push(`${r.pincode} | ${r.city} | ${r.state} | ${r.orders} | ${fmt(r.profitabilityScore, 0)} | ${fmt(r.rtoPercent, 1)}% | ${fmt(r.codPercent, 1)}% | ${fmt(r.deliveredPercent, 1)}%`)
    }
    lines.push('')
  }

  // --- Anomalies ---
  if (anomalies.length > 0) {
    lines.push('### Daily Shipment Anomalies')
    for (const a of anomalies.slice(0, 4)) {
      lines.push(`- ${a.date}: ${a.metric} = ${a.value.toFixed(0)} (${a.zScore > 0 ? 'spike' : 'drop'}, z=${a.zScore.toFixed(1)})`)
    }
    lines.push('')
  }

  // --- Trends ---
  if (trends.length > 0) {
    lines.push('### Shipment Volume Trends')
    for (const t of trends) {
      lines.push(`- ${t.metric}: ${t.direction} (velocity ${t.velocity.toFixed(2)}%/day)`)
    }
    lines.push('')
  }

  // Revenue concentration
  const top3Rev = topRevenuePincodes.slice(0, 3).reduce((sum, r) => sum + r.revenue, 0)
  const totalRev = s.totalRevenue ?? 0
  const top3Share = totalRev > 0 ? Math.round((top3Rev / totalRev) * 100) : 0

  // --- AI Focus Instructions ---
  lines.push(`### Analysis Focus
Generate 7–9 insights. Think like a D2C operations director making geographic strategy decisions.

**Profitability Score Formula:** 100 - (rto% × 2) - (cod% × 0.5) + (repeat% × 0.5) + (aov/₹1000 × 10). Explains the score column.

1. **COD Restriction Action Plan** — ${codKillList.length > 0 ? `${codKillList.length} pincodes qualify for immediate COD restriction (high RTO + high COD)` : 'No emergency COD restrictions needed'}. For each pincode on the kill list, estimate monthly RTO savings if COD is disabled. Give a clear implementation recommendation.

2. **State-Level Net Profitability** — Which states are genuinely profitable (high delivered%, low RTO%, good scores)? Which are net-negative (high RTO destroying revenue)? Rank top 3 states to double down on and flag any states to deprioritize or restrict COD.

3. **Tier Performance Gap** — T1/T2/T3 comparison reveals the geography-quality tradeoff. T3 cities often have 3–4× higher RTO than T1 but may have underserved demand. At current T3 RTO rate (${fmt(tierSummaries.find(t => t.tier === 'T3')?.rtoPercent, 1)}%), is T3 expansion worth the cost? Quantify.

4. **Revenue Concentration Risk** — Top 3 pincodes = ${top3Share}% of revenue. Is this dangerous concentration? Recommend geographic diversification targets or celebrate the focus.

5. **Loyalty Hotspots → Retention Strategy** — ${loyaltyGems.length > 0 ? `${loyaltyGems.length} pincodes have exceptional repeat rates` : 'Look for pincodes with high repeat rates'}. These are your most loyal customer clusters. Recommend subscription offers, loyalty programs, or influencer partnerships in these specific cities.

6. **Expansion Opportunities** — ${expansionOpps.length > 0 ? `${expansionOpps.length} T3 pincodes with profitability score ≥65 are underserved` : 'Look for high-score T3 pincodes'}. These have good delivery rates and repeat customers but low order volume — prime targets for performance marketing spend.

7. **RTO Hotspot Root Causes** — Name the worst RTO pincodes and diagnose WHY. Is it COD-heavy (address quality)? Specific courier (delivery network gap)? T3 geography (cash economy)? Each cause has a different fix.

8. **Courier-Geography Alignment** — Are high-RTO pincodes using the wrong courier? Name specific pincodes where the top courier's network is likely the problem and suggest switching.

9. **Premium Geography Signal** — Which pincodes/cities show high AOV (>₹2000) with low RTO? These are premium customer clusters — ideal for upsell campaigns, premium products, and higher-margin offerings.

Be surgical. Name specific pincodes and cities. Every rupee figure must be quantified. The merchant should leave with a list of pincode-level actions to implement in Shiprocket.`)

  return lines.join('\n')
}
