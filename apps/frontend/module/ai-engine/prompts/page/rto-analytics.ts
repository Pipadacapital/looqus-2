import type { PeriodComparison } from '../../analysis/comparator'
import type { Anomaly } from '../../analysis/anomaly'
import type { TrendResult } from '../../analysis/trend'

type RtoCourierSummary = {
  courierName: string
  rtoCount: number
  rtoRate: number | null
  rtoCost: number
  revenueLost: number
  totalShipments: number
}

type RtoProductSummary = {
  productTitle: string
  quantity: number
  revenueLost: number
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null || isNaN(n as number)) return '—'
  return (n as number).toFixed(decimals)
}

function inr(n: number | null | undefined): string {
  if (n == null) return '—'
  return `₹${(n as number).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function pctChange(comparison: PeriodComparison, key: string): string {
  const c = comparison[key]
  if (!c || c.changePercent == null) return ''
  const arrow = c.changePercent >= 0 ? '▲' : '▼'
  return ` (${arrow}${Math.abs(c.changePercent).toFixed(1)}% vs prior)`
}

function rtoSeverityLabel(rate: number | null): string {
  if (rate == null) return 'unknown'
  if (rate < 5) return 'excellent (<5%)'
  if (rate < 10) return 'good (5–10%)'
  if (rate < 15) return 'warning (10–15%)'
  if (rate < 20) return 'high (15–20%)'
  return 'critical (>20%)'
}

export function buildRtoAnalyticsPrompt(
  context: any,
  comparison: PeriodComparison,
  anomalies: Anomaly[],
  trends: TrendResult[]
): string {
  const s = context.summary as Record<string, number | null>
  const p = context.priorSummary as Record<string, number | null>
  const byCourier = (context.extra?.byCourier ?? []) as RtoCourierSummary[]
  const byProduct = (context.extra?.byProduct ?? []) as RtoProductSummary[]

  const from = context.dateRange.from instanceof Date
    ? context.dateRange.from.toISOString().slice(0, 10)
    : String(context.dateRange.from).slice(0, 10)
  const to = context.dateRange.to instanceof Date
    ? context.dateRange.to.toISOString().slice(0, 10)
    : String(context.dateRange.to).slice(0, 10)

  const lines: string[] = []

  lines.push(`## RTO Analytics: ${from} to ${to}`)
  lines.push(`Data: ${context.daily.length} days of shipment data.\n`)

  // --- Core RTO KPIs ---
  lines.push('### Core RTO KPIs')
  lines.push(`- Total Shipments: ${fmt(s.totalShipments)}`)
  lines.push(`- RTO Count: ${fmt(s.rtoCount)}${pctChange(comparison, 'rtoCount')}`)
  lines.push(`- RTO Rate: ${fmt(s.rtoRatePercent, 1)}% — ${rtoSeverityLabel(s.rtoRatePercent)}${pctChange(comparison, 'rtoRatePercent')}`)
  lines.push(`- Shiprocket RTO Charges (cost): ${inr(s.totalRtoCost)}${pctChange(comparison, 'totalRtoCost')}`)
  lines.push(`- Revenue Lost to RTO: ${inr(s.revenueLostToRto)}${pctChange(comparison, 'revenueLostToRto')}`)
  lines.push(`- Total Loss Per RTO Shipment: ${inr(s.totalLossPerRto)} (cost + revenue)`)
  lines.push(`- Avg RTO Charge/Shipment: ${inr(s.avgRtoCostPerShipment)}`)
  lines.push('')

  // Prior period comparison
  if (p.rtoRatePercent != null) {
    const rateDelta = (s.rtoRatePercent ?? 0) - (p.rtoRatePercent ?? 0)
    const direction = rateDelta > 0 ? 'worsened' : 'improved'
    lines.push(`Prior period: RTO rate ${fmt(p.rtoRatePercent, 1)}% → Current ${fmt(s.rtoRatePercent, 1)}% (${direction} by ${Math.abs(rateDelta).toFixed(1)}pp)`)
    lines.push(`Prior period revenue lost: ${inr(p.revenueLostToRto)} | Current: ${inr(s.revenueLostToRto)}`)
    lines.push('')
  }

  // --- COD vs Prepaid RTO Split ---
  lines.push('### COD vs Prepaid RTO Split')
  lines.push(`COD shipments: ${fmt(s.codTotalShipments)} → RTO ${fmt(s.codRtoCount)} (rate: ${fmt(s.codRtoRatePercent, 1)}%)`)
  lines.push(`Prepaid shipments: ${fmt(s.prepaidTotalShipments)} → RTO ${fmt(s.prepaidRtoCount)} (rate: ${fmt(s.prepaidRtoRatePercent, 1)}%)`)
  lines.push(`COD revenue lost: ${inr(s.codRevenueLost)} | Prepaid revenue lost: ${inr(s.prepaidRevenueLost)}`)

  const codRateRaw = s.codRtoRatePercent ?? 0
  const prepaidRateRaw = s.prepaidRtoRatePercent ?? 0
  if (codRateRaw > 0 && prepaidRateRaw > 0) {
    const ratio = (codRateRaw / prepaidRateRaw).toFixed(1)
    lines.push(`COD RTO rate is ${ratio}x higher than prepaid — typical for D2C (expected 2–4x). Higher = more COD risk.`)
  }
  lines.push(`Prior COD RTO rate: ${fmt(p.codRtoRatePercent, 1)}% | Prior Prepaid RTO rate: ${fmt(p.prepaidRtoRatePercent, 1)}%`)
  lines.push('')

  // --- Courier Accountability ---
  if (byCourier.length > 0) {
    lines.push('### Courier RTO Accountability')
    lines.push('courier | total shipments | rto count | rto rate% | rto cost | revenue lost')
    for (const c of byCourier) {
      lines.push(`${c.courierName} | ${c.totalShipments} | ${c.rtoCount} | ${fmt(c.rtoRate, 1)}% | ${inr(c.rtoCost)} | ${inr(c.revenueLost)}`)
    }

    // Highlight worst performer
    const worst = byCourier.reduce((a, b) => ((a.rtoRate ?? 0) > (b.rtoRate ?? 0) ? a : b))
    lines.push(`\nWorst courier by RTO rate: ${worst.courierName} at ${fmt(worst.rtoRate, 1)}% (${worst.rtoCount} RTOs, ${inr(worst.revenueLost)} revenue lost)`)
    lines.push('')
  }

  // --- Product-Level RTO ---
  if (byProduct.length > 0) {
    lines.push('### Top Products by RTO Revenue Lost (Shopify-matched)')
    lines.push('product | qty returned | revenue lost')
    for (const prod of byProduct) {
      lines.push(`${prod.productTitle} | ${prod.quantity} | ${inr(prod.revenueLost)}`)
    }
    lines.push('')
  }

  // --- Anomalies ---
  if (anomalies.length > 0) {
    lines.push('### Detected Anomalies (Statistical)')
    for (const a of anomalies.slice(0, 6)) {
      lines.push(`- ${a.date}: ${a.metric} = ${a.value.toFixed(1)} (${a.zScore > 0 ? 'spike' : 'drop'}, z=${a.zScore.toFixed(1)})`)
    }
    lines.push('')
  }

  // --- Trends ---
  if (trends.length > 0) {
    lines.push('### RTO Metric Trends')
    for (const t of trends) {
      lines.push(`- ${t.metric}: ${t.direction} (velocity ${t.velocity.toFixed(2)}%/day, consistency=${t.consistency.toFixed(2)})`)
    }
    lines.push('')
  }

  // --- Daily Data Table ---
  lines.push('### Daily RTO Data (recent 30 days)')
  lines.push('date|totalShipments|rtoCount|rtoRate%|rtoCost|revenueLost')
  for (const d of context.daily) {
    lines.push(`${d.date}|${d.totalShipments}|${d.rtoCount}|${d.rtoRate}|${d.rtoCost}|${d.revenueLost}`)
  }
  lines.push('')

  // --- AI Focus Instructions ---
  lines.push(`### Analysis Focus
Generate 6–8 insights. RTO is one of the biggest hidden profit destroyers for D2C brands. Be specific, quantify rupee impact, name couriers.

1. **RTO rate severity & trend** — Is ${fmt(s.rtoRatePercent, 1)}% improving or worsening vs prior (${fmt(p.rtoRatePercent, 1)}%)? Benchmark: <10% good, 10–20% warning, >20% critical for India D2C. Flag the trend velocity.

2. **Total financial destruction** — Quantify the combined hit: RTO charges ${inr(s.totalRtoCost)} + revenue lost ${inr(s.revenueLostToRto)} = total loss. Express as % of (estimated) revenue impact. Per-RTO loss = ${inr(s.totalLossPerRto)}.

3. **COD vs Prepaid RTO differential** — COD rate ${fmt(s.codRtoRatePercent, 1)}% vs Prepaid rate ${fmt(s.prepaidRtoRatePercent, 1)}%. Is the ratio healthy or abnormal? Recommend COD-to-prepaid conversion or IVR verification for COD orders if COD rate exceeds 15%.

4. **Courier accountability** — Name the worst-performing courier(s) by RTO rate. Quantify how much extra loss they cause vs the best courier. Should volume be shifted? Are any couriers improving or degrading vs prior period?

5. **RTO anomaly spikes** — Were there specific dates with abnormal RTO surges? What might explain them — festival season, COD address issues, courier network overload? Pattern-match against the daily data.

6. **Product RTO signals** (if data available) — Which products drive the most RTO revenue loss? High-RTO products may have quality issues, misleading descriptions, or require prepaid enforcement.

7. **Per-shipment loss escalation** — At ${inr(s.totalLossPerRto)} total loss per RTO and ${fmt(s.rtoRatePercent, 1)}% rate, project annual impact if not addressed. Is the per-RTO cost rising?

8. **Concrete reduction playbook** — Recommend 2–3 specific, implementable actions: address verification (Shiprocket NDR workflow), prepaid incentives for high-RTO pincodes, courier rebalancing, or product-level restrictions.

Be ruthlessly specific. Name numbers, name couriers, name products. Every insight should make the merchant want to take immediate action.`)

  return lines.join('\n')
}
