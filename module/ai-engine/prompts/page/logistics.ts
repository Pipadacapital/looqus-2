import type { PeriodComparison } from '../../analysis/comparator'
import type { Anomaly } from '../../analysis/anomaly'
import type { TrendResult } from '../../analysis/trend'

type CourierSummary = {
  courierName: string
  count: number
  deliveredCount: number
  rtoCount: number
  deliveryRate: number | null
  rtoRate: number | null
  totalCharges: number
  avgCostPerShipment: number | null
}

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

export function buildLogisticsPrompt(
  context: any,
  comparison: PeriodComparison,
  anomalies: Anomaly[],
  trends: TrendResult[]
): string {
  const s = context.summary as Record<string, number | null>
  const p = context.priorSummary as Record<string, number | null>
  const couriers = (context.extra?.couriers ?? []) as CourierSummary[]

  const from = context.dateRange.from instanceof Date
    ? context.dateRange.from.toISOString().slice(0, 10)
    : String(context.dateRange.from).slice(0, 10)
  const to = context.dateRange.to instanceof Date
    ? context.dateRange.to.toISOString().slice(0, 10)
    : String(context.dateRange.to).slice(0, 10)

  const lines: string[] = []

  lines.push(`## Logistics Performance: ${from} to ${to}`)
  lines.push(`Data: ${context.daily.length} days with shipment data.\n`)

  // --- Overview ---
  lines.push('### Shipment Overview')
  lines.push(`- Total Shipments: ${fmt(s.totalShipments)}${pctChange(comparison, 'totalShipments')}`)
  lines.push(`- Delivered: ${fmt(s.deliveredCount)} (${fmt(s.deliveredPercent, 1)}%)${pctChange(comparison, 'deliveredPercent')}`)
  lines.push(`- RTO (Return to Origin): ${fmt(s.rtoCount)} (${fmt(s.rtoPercent, 1)}%)${pctChange(comparison, 'rtoPercent')} ← profitability killer`)
  lines.push(`- COD: ${fmt(s.codCount)} (${fmt(s.codPercent, 1)}%) | Prepaid: ${fmt(s.prepaidCount)}`)
  lines.push('')

  if (p.totalShipments != null && p.totalShipments > 0) {
    lines.push(`Prior period: ${fmt(p.totalShipments)} shipments | Delivered ${fmt(p.deliveredPercent, 1)}% | RTO ${fmt(p.rtoPercent, 1)}% | Avg cost ₹${fmt(p.avgCostPerShipment, 2)}\n`)
  }

  // --- Cost Breakdown ---
  lines.push('### Logistics Cost Breakdown')
  lines.push(`- Forward (outbound) charges: ₹${fmt(s.forwardCharges)}${pctChange(comparison, 'forwardCharges')}`)
  lines.push(`- COD handling charges: ₹${fmt(s.codCharges)}`)
  lines.push(`- RTO (return) charges: ₹${fmt(s.rtoCharges)}${pctChange(comparison, 'rtoCharges')} ← wasted spend on failed deliveries`)
  lines.push(`- Total Shiprocket charges: ₹${fmt(s.totalShiprocketCharges)}${pctChange(comparison, 'totalShiprocketCharges')}`)
  lines.push(`- Avg cost per shipment: ₹${fmt(s.avgCostPerShipment, 2)}${pctChange(comparison, 'avgCostPerShipment')}`)
  lines.push('')

  // RTO cost as % of total
  const rtoCostPct = (s.totalShiprocketCharges ?? 0) > 0
    ? ((s.rtoCharges ?? 0) / (s.totalShiprocketCharges ?? 1) * 100).toFixed(1)
    : null
  if (rtoCostPct) {
    lines.push(`Note: RTO charges = ${rtoCostPct}% of total logistics spend (industry benchmark: keep below 10%)`)
    lines.push('')
  }

  // --- Courier Performance ---
  if (couriers.length > 0) {
    lines.push('### Courier Performance (by volume)')
    lines.push('courier | shipments | delivery% | rto% | total charges | avg ₹/shipment')
    for (const c of couriers) {
      lines.push(`${c.courierName} | ${c.count} | ${fmt(c.deliveryRate, 1)}% | ${fmt(c.rtoRate, 1)}% | ₹${fmt(c.totalCharges)} | ₹${fmt(c.avgCostPerShipment, 2)}`)
    }
    lines.push('')
  }

  // --- Anomalies ---
  if (anomalies.length > 0) {
    lines.push('### Detected Anomalies')
    for (const a of anomalies.slice(0, 5)) {
      lines.push(`- ${a.date}: ${a.metric} was ${a.value.toFixed(0)} (${a.zScore > 0 ? 'spike' : 'drop'}, z=${a.zScore.toFixed(1)})`)
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
  lines.push('date|shipments|delivered|rto|rtoRate%|forwardCharges|rtoCharges|totalCharges')
  for (const d of context.daily) {
    lines.push(`${d.date}|${d.shipments}|${d.delivered}|${d.rto}|${d.rtoRate}|${d.forwardCharges}|${d.rtoCharges}|${d.totalCharges}`)
  }
  lines.push('')

  // --- AI Focus Instructions ---
  lines.push(`### Analysis Focus
Generate 5-7 insights covering:
1. **RTO rate health** — Is RTO% improving or worsening vs prior period? Flag if above 15% (D2C India benchmark). Identify daily spikes.
2. **RTO cost impact** — How much total logistics spend is wasted on returns? RTO charges as % of total spend. Quantify the rupee loss.
3. **Courier efficiency** — Which courier has the worst delivery rate or highest per-shipment cost? Recommend rebalancing volume away from poor performers.
4. **COD risk concentration** — COD shipments have 2-3x higher RTO risk than prepaid. Is COD% increasing? High COD + rising RTO = compounding cost problem.
5. **Avg cost per shipment trend** — Rising avg cost signals courier rate hikes or shipment weight increase. Compare vs prior and flag if material.
6. **RTO anomaly dates** — Were there specific days with RTO or cost spikes? Identify patterns (end of month? specific courier? volume surge?).
7. **Operational efficiency score** — At current delivery rate and avg cost, assess whether logistics is eating into CM2/CM3. Recommend 1-2 specific actions to reduce RTO or cost.

Be specific. Name couriers. Quantify the impact in rupees and percentages. RTO is a profitability killer for D2C brands — make it actionable.`)

  return lines.join('\n')
}
