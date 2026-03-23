import type { PeriodComparison } from '../../analysis/comparator'
import type { Anomaly } from '../../analysis/anomaly'
import type { TrendResult } from '../../analysis/trend'

type CampaignSummary = {
  name: string
  intent: string
  spend: number
  revenue: number
  roas: number
  ctr: number
  cpc: number
  atcRate: number | null
  checkoutFromAtc: number | null
  purchaseFromCheckout: number | null
  overallCvr: number
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

export function buildMetaAdsPrompt(
  context: any,
  comparison: PeriodComparison,
  anomalies: Anomaly[],
  trends: TrendResult[]
): string {
  const s = context.summary as Record<string, number | null>
  const p = context.priorSummary as Record<string, number | null>
  const campaigns = (context.extra?.campaigns ?? []) as CampaignSummary[]
  const hasFunnel = (s.addToCart ?? 0) > 0

  const from = context.dateRange.from instanceof Date
    ? context.dateRange.from.toISOString().slice(0, 10)
    : String(context.dateRange.from).slice(0, 10)
  const to = context.dateRange.to instanceof Date
    ? context.dateRange.to.toISOString().slice(0, 10)
    : String(context.dateRange.to).slice(0, 10)

  const lines: string[] = []

  lines.push(`## Meta Ads Performance: ${from} to ${to}`)
  lines.push(`Data: ${context.daily.length} days with spend data.\n`)

  // --- Overall Performance ---
  lines.push('### Overall Performance')
  lines.push(`- Total Spend: ₹${fmt(s.totalSpend)}${pctChange(comparison, 'totalSpend')}`)
  lines.push(`- Attributed Revenue: ₹${fmt(s.totalRevenue)}${pctChange(comparison, 'totalRevenue')}`)
  lines.push(`- ROAS: ${fmt(s.roas, 2)}x${pctChange(comparison, 'roas')}`)
  lines.push(`- Impressions: ${fmt(s.totalImpressions)}${pctChange(comparison, 'totalImpressions')}`)
  lines.push(`- Clicks: ${fmt(s.totalClicks)} | CTR: ${fmt(s.ctr, 2)}%${pctChange(comparison, 'ctr')}`)
  lines.push(`- CPC: ₹${fmt(s.cpc)} | CPM: ₹${fmt(s.cpm)}`)
  lines.push(`- Conversions: ${fmt(s.totalConversions)} | Overall CVR: ${fmt(s.overallCvr, 2)}%\n`)

  if (p.totalSpend != null && p.totalSpend > 0) {
    lines.push(`Prior period: Spend ₹${fmt(p.totalSpend)} | Revenue ₹${fmt(p.totalRevenue)} | ROAS ${fmt(p.roas, 2)}x\n`)
  }

  // --- Acquisition vs Retention Split ---
  lines.push('### Acquisition vs Retention Split')
  const acqPct = s.acqSpendPct ?? 0
  const retPct = 100 - acqPct
  lines.push(`- Acquisition: ${fmt(acqPct, 1)}% of spend (₹${fmt(s.acqSpend)}) → ROAS ${fmt(s.acqRoas, 2)}x | Revenue ₹${fmt(s.acqRevenue)}`)
  lines.push(`- Retention/Other: ${fmt(retPct, 1)}% of spend (₹${fmt(s.retSpend)}) → ROAS ${fmt(s.retRoas, 2)}x | Revenue ₹${fmt(s.retRevenue)}`)
  lines.push(`Note: Acquisition campaigns drive new customers; retention campaigns re-engage existing buyers.\n`)

  // --- Funnel Analysis ---
  lines.push('### Funnel Analysis')
  if (hasFunnel) {
    lines.push(`Impressions → Clicks → Add-to-Cart → Checkout → Purchase`)
    lines.push(`${fmt(s.totalImpressions)} → ${fmt(s.totalClicks)} (CTR ${fmt(s.ctr, 2)}%) → ${fmt(s.addToCart)} (ATC rate ${fmt(s.atcRatePct, 1)}% of clicks) → ${fmt(s.checkoutInitiated)} (${fmt(s.checkoutPerAtcPct, 1)}% of ATC) → ${fmt(s.totalConversions)} purchases (${fmt(s.purchasePerCheckoutPct, 1)}% of checkout)`)
    lines.push(`- Cost per ATC: ₹${fmt(s.costPerAtc)} | Cost per checkout: ₹${fmt(s.costPerCheckout)} | Cost per purchase: ₹${fmt(s.costPerPurchase)}`)
    lines.push(`- Overall click-to-purchase CVR: ${fmt(s.overallCvr, 2)}%`)
    lines.push(``)
    lines.push(`Benchmarks: ATC rate >12% = strong | Checkout/ATC >48% = strong | Purchase/Checkout >55% = strong | CVR >2.5% = strong`)
  } else {
    lines.push(`Pixel ATC/checkout data not available. Only aggregate conversions tracked.`)
    lines.push(`- Conversions: ${fmt(s.totalConversions)} | CVR: ${fmt(s.overallCvr, 2)}% | Cost per purchase: ₹${fmt(s.costPerPurchase)}`)
  }
  lines.push('')

  // --- Campaign Performance ---
  if (campaigns.length > 0) {
    lines.push('### Top Campaigns (by spend)')
    if (hasFunnel) {
      lines.push('name | intent | spend | ROAS | CTR% | ATC% | CI/ATC% | Purch/CI% | CVR%')
      for (const c of campaigns) {
        lines.push(`${c.name} | ${c.intent} | ₹${fmt(c.spend)} | ${fmt(c.roas, 2)}x | ${fmt(c.ctr, 2)} | ${c.atcRate != null ? fmt(c.atcRate, 1) : '—'} | ${c.checkoutFromAtc != null ? fmt(c.checkoutFromAtc, 1) : '—'} | ${c.purchaseFromCheckout != null ? fmt(c.purchaseFromCheckout, 1) : '—'} | ${fmt(c.overallCvr, 2)}`)
      }
    } else {
      lines.push('name | intent | spend | ROAS | CTR% | CPC | conversions | CVR%')
      for (const c of campaigns) {
        lines.push(`${c.name} | ${c.intent} | ₹${fmt(c.spend)} | ${fmt(c.roas, 2)}x | ${fmt(c.ctr, 2)} | ₹${fmt(c.cpc)} | ${fmt((c as any).conversions ?? 0)} | ${fmt(c.overallCvr, 2)}`)
      }
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
  lines.push('date|spend|revenue|roas|impressions|clicks|conversions')
  for (const d of context.daily) {
    lines.push(`${d.date}|${d.spend}|${d.revenue}|${d.roas}|${d.impressions}|${d.clicks}|${d.conversions}`)
  }
  lines.push('')

  // --- Goals ---
  if (context.goals?.length > 0) {
    lines.push('### Workspace Goals')
    for (const g of context.goals) {
      lines.push(`- ${g.label}: goal=${fmt(g.goal, 2)} actual=${fmt(g.actual, 2)} (${g.rag.toUpperCase()})`)
    }
    lines.push('')
  }

  // --- AI Focus Instructions ---
  lines.push(`### Analysis Focus
Generate 5-7 insights covering:
1. **ROAS efficiency** — Is ROAS improving or compressing? Why? (CPM, CTR, CVR trends)
2. **Acquisition vs Retention balance** — Is the split healthy? Is retention spend cannibalizing acq budget?
3. **Funnel leaks** — Which funnel stage has the worst drop-off? ATC rate low = creative/landing page issue. Checkout→Purchase low = payment/UX friction.
4. **Campaign-level winners/losers** — Which campaigns are scaling efficiently? Which have high spend but low ROAS and should be paused/restructured?
5. **CPM trend** — Rising CPM signals auction pressure or audience saturation. Falling CPM with stable CTR = healthy.
6. **Creative performance signal** — If CTR is falling on high-spend campaigns, creative fatigue may be the cause.
7. **Scaling opportunity** — Which acquisition campaigns have ROAS well above target and could absorb more budget?

Be specific about numbers. Name campaigns when recommending action. Prioritize insights that directly affect profitability.`)

  return lines.join('\n')
}
