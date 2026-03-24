import type { PeriodComparison } from '../../analysis/comparator'
import type { Anomaly } from '../../analysis/anomaly'
import type { TrendResult } from '../../analysis/trend'

type ProductRow = {
  label: string
  paretoGrade: 'A' | 'B' | 'C' | 'F'
  cm1: number
  cm1Pct: number
  cm1Total: number
  revenue: number
  sales: number
  refunds: number
  sold: number
  returnRate: number
  ncOrders: number
  ecOrders: number
  orders: number
  ncAov: number
  ecAov: number
  aov: number
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

function gradeLabel(pct: number): string {
  if (pct >= 80) return 'healthy'
  if (pct >= 60) return 'moderate'
  if (pct >= 40) return 'low'
  return 'poor'
}

export function buildProductsPrompt(
  context: any,
  comparison: PeriodComparison,
  anomalies: Anomaly[],
  trends: TrendResult[]
): string {
  const s = context.summary as Record<string, number | null>
  const p = context.priorSummary as Record<string, number | null>
  const topProducts = (context.extra?.topProducts ?? []) as ProductRow[]
  const bottomProducts = (context.extra?.bottomProducts ?? []) as ProductRow[]
  const highReturnProducts = (context.extra?.highReturnProducts ?? []) as ProductRow[]
  const priorTopProducts = (context.extra?.priorTopProducts ?? []) as ProductRow[]
  const totalScanned = context.extra?.totalProductsScanned as number | undefined

  const from = context.dateRange.from instanceof Date
    ? context.dateRange.from.toISOString().slice(0, 10)
    : String(context.dateRange.from).slice(0, 10)
  const to = context.dateRange.to instanceof Date
    ? context.dateRange.to.toISOString().slice(0, 10)
    : String(context.dateRange.to).slice(0, 10)

  const lines: string[] = []

  lines.push(`## Product Analytics: ${from} to ${to}`)
  lines.push(`Analysed: ${totalScanned ?? (s.totalProducts ?? 0)} products | Showing top 100 by CM1.\n`)

  // --- Portfolio-Level Summary ---
  lines.push('### Portfolio Summary')
  lines.push(`- Total Revenue: ${inr(s.totalRevenue)}${pctChange(comparison, 'totalRevenue')}`)
  lines.push(`- Total CM1: ${inr(s.totalCm1)}${pctChange(comparison, 'totalCm1')}`)
  lines.push(`- Avg CM1%: ${fmt(s.avgCm1Pct, 1)}%${pctChange(comparison, 'avgCm1Pct')} — ${gradeLabel(s.avgCm1Pct ?? 0)} for D2C`)
  lines.push(`- Total Products Analysed: ${fmt(s.totalProducts)}`)
  lines.push(`- Total Refunds: ${inr(s.totalRefunds)} | Total Units Sold: ${fmt(s.totalSold)}`)
  lines.push(`- Avg Return Rate: ${fmt(s.avgReturnRate, 1)}%`)
  lines.push('')

  // Pareto grade distribution
  const total = s.totalProducts ?? 1
  const aShare = Math.round(((s.gradeACount ?? 0) / total) * 100)
  const fShare = Math.round(((s.gradeFCount ?? 0) / total) * 100)
  lines.push('### Pareto Grade Distribution (current period)')
  lines.push(`A (top 80% CM1): ${fmt(s.gradeACount)} products (${aShare}%) — revenue heroes`)
  lines.push(`B (80–95% CM1):  ${fmt(s.gradeBCount)} products — solid contributors`)
  lines.push(`C (95–100% CM1): ${fmt(s.gradeCCount)} products — marginal`)
  lines.push(`F (negative CM1): ${fmt(s.gradeFCount)} products (${fShare}%) — margin destroyers`)
  lines.push(`Positive CM1: ${fmt(s.positiveCm1Products)} | Negative CM1: ${fmt(s.negativeCm1Products)} products`)
  lines.push('')

  if (p.totalRevenue != null && p.totalRevenue > 0) {
    lines.push(`Prior period: Revenue ${inr(p.totalRevenue)} | CM1 ${inr(p.totalCm1)} | Avg CM1% ${fmt(p.avgCm1Pct, 1)}% | Grade F products: ${fmt(p.gradeFCount)}`)
    lines.push('')
  }

  // --- Hero Products ---
  if (topProducts.length > 0) {
    lines.push('### Top Products by CM1 (Heroes)')
    lines.push('product | grade | cm1% | cm1-total | revenue | units | return% | nc-orders | ec-orders | aov')
    for (const r of topProducts) {
      lines.push(`${r.label} | ${r.paretoGrade} | ${fmt(r.cm1Pct, 1)}% | ${inr(r.cm1Total)} | ${inr(r.revenue)} | ${r.sold} | ${fmt(r.returnRate, 1)}% | ${r.ncOrders} | ${r.ecOrders} | ${inr(r.aov)}`)
    }
    lines.push('')
  }

  // --- Margin Destroyers ---
  if (bottomProducts.length > 0) {
    lines.push('### Margin Destroyers (Negative CM1)')
    lines.push('product | cm1% | cm1-total-loss | revenue | units | return%')
    for (const r of bottomProducts) {
      lines.push(`${r.label} | ${fmt(r.cm1Pct, 1)}% | ${inr(r.cm1Total)} | ${inr(r.revenue)} | ${r.sold} | ${fmt(r.returnRate, 1)}%`)
    }
    lines.push('')
  } else {
    lines.push('No products with negative CM1 in this period. ✓\n')
  }

  // --- High Return Rate Products ---
  if (highReturnProducts.length > 0) {
    lines.push('### High Return Rate Products (min 5 orders)')
    lines.push('product | return% | units-returned | revenue | cm1%')
    for (const r of highReturnProducts) {
      const returned = r.sold - r.sold + (r.refunds > 0 ? Math.round(r.refunds / (r.aov || 1)) : 0)
      lines.push(`${r.label} | ${fmt(r.returnRate, 1)}% | ~${Math.round(r.sold * r.returnRate / 100)} | ${inr(r.revenue)} | ${fmt(r.cm1Pct, 1)}%`)
    }
    lines.push('')
  }

  // --- NC vs EC comparison for top products ---
  if (topProducts.length > 0) {
    const topNcEc = topProducts.slice(0, 5)
    const hasNcData = topNcEc.some((r) => r.ncOrders > 0)
    if (hasNcData) {
      lines.push('### New Customer vs Repeat Customer Split (top 5 products)')
      lines.push('product | nc-orders | ec-orders | nc-aov | ec-aov | nc-premium')
      for (const r of topNcEc) {
        const premium = r.ecAov > 0 && r.ncAov > 0
          ? ((r.ncAov - r.ecAov) / r.ecAov * 100).toFixed(1)
          : '—'
        lines.push(`${r.label} | ${r.ncOrders} NC | ${r.ecOrders} EC | ${inr(r.ncAov)} | ${inr(r.ecAov)} | ${premium}%`)
      }
      lines.push('')
    }
  }

  // --- Prior period comparison for top products ---
  if (priorTopProducts.length > 0 && topProducts.length > 0) {
    const priorMap = new Map(priorTopProducts.map((r) => [r.label, r]))
    const movers: string[] = []
    for (const cur of topProducts.slice(0, 5)) {
      const prev = priorMap.get(cur.label)
      if (prev) {
        const cm1Change = prev.cm1Total !== 0
          ? ((cur.cm1Total - prev.cm1Total) / Math.abs(prev.cm1Total) * 100).toFixed(1)
          : null
        if (cm1Change != null) {
          const arrow = parseFloat(cm1Change) >= 0 ? '▲' : '▼'
          movers.push(`${cur.label}: CM1 ${arrow}${Math.abs(parseFloat(cm1Change))}% (${inr(prev.cm1Total)} → ${inr(cur.cm1Total)})`)
        }
      }
    }
    if (movers.length > 0) {
      lines.push('### Period-over-Period CM1 Movement (top products)')
      movers.forEach((m) => lines.push(`- ${m}`))
      lines.push('')
    }
  }

  // --- Anomalies ---
  if (anomalies.length > 0) {
    lines.push('### Revenue/Order Anomalies (daily level)')
    for (const a of anomalies.slice(0, 5)) {
      lines.push(`- ${a.date}: ${a.metric} = ${a.value.toFixed(0)} (${a.zScore > 0 ? 'spike' : 'drop'}, z=${a.zScore.toFixed(1)})`)
    }
    lines.push('')
  }

  // --- Trends ---
  if (trends.length > 0) {
    lines.push('### Overall Revenue/Order Trends')
    for (const t of trends) {
      lines.push(`- ${t.metric}: ${t.direction} (velocity ${t.velocity.toFixed(2)}%/day, consistency=${t.consistency.toFixed(2)})`)
    }
    lines.push('')
  }

  // --- AI Focus Instructions ---
  const heroCount = topProducts.length
  const destroyerCount = bottomProducts.length
  const cm1Pct = fmt(s.avgCm1Pct, 1)
  const gradeF = fmt(s.gradeFCount)

  lines.push(`### Analysis Focus
Generate 6–8 insights. Focus on actionable SKU-level decisions that improve portfolio CM1%.

1. **Portfolio CM1 health** — At ${cm1Pct}% avg CM1% (${gradeLabel(s.avgCm1Pct ?? 0)}), is the portfolio healthy? How does it compare to prior period (${fmt(p.avgCm1Pct, 1)}%)? Quantify what a 1% improvement in avg CM1% means in rupees.

2. **Hero product concentration risk** — The top ${Math.min(heroCount, 3)} products likely drive a disproportionate share of CM1. Name them. If 1-2 products fail, what % of CM1 is at risk? Recommend building the bench.

3. **Margin destroyer action plan** — ${destroyerCount > 0 ? `${gradeF} products have negative CM1, destroying ${inr(Math.abs(bottomProducts.reduce((sum, r) => sum + r.cm1Total, 0)))} in margin` : 'No negative CM1 products — strong portfolio'}. For each margin destroyer: should it be discontinued, repriced, or reformulated? Be specific.

4. **Return rate red flags** — High return rates compound margin problems: every return = lost revenue + forward shipping cost + RTO cost. Products with >15% return rate need investigation. Name them and estimate annual margin leak.

5. **NC vs EC product mix** — Are hero products driving new customer acquisition or mostly repeat purchases? Products with high EC orders are retention anchors; products with high NC orders are acquisition engines. Both matter differently.

6. **Pareto grade migration** — Did any products move from grade A→B or B→F vs prior period? Name the fallers. These are early warning signals that need attention before full degradation.

7. **Pricing vs volume opportunity** — Products with high CM1% but low revenue have pricing or volume headroom. Products with high revenue but low CM1% are volume traps. Identify one product in each category.

8. **Portfolio recommendation** — Give 1–2 specific SKU-level actions the merchant should take in the next 30 days (e.g., "Discontinue [product X]", "Increase price of [product Y] by 15%", "Bundle [A] with [B] to improve EC AOV").

Be brutal and specific. Name SKUs. Quantify the rupee impact of every recommendation. A merchant who reads this should know exactly which 3 things to do tomorrow.`)

  return lines.join('\n')
}
