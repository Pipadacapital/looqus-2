import type { PeriodComparison } from '../../analysis/comparator'
import type { Anomaly } from '../../analysis/anomaly'
import type { TrendResult } from '../../analysis/trend'

type CampaignSummary = {
  name: string
  intent: string
  spend: number
  conversionValue: number
  roas: number
  ctr: number
  cpc: number
  conversions: number
  atcRate: number | null
  checkoutFromAtc: number | null
  purchaseFromCheckout: number | null
  overallCvr: number
  hasStagedFunnel: boolean
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

export function buildGoogleAdsPrompt(
  context: any,
  comparison: PeriodComparison,
  anomalies: Anomaly[],
  trends: TrendResult[]
): string {
  const s = context.summary as Record<string, number | null>
  const p = context.priorSummary as Record<string, number | null>
  const campaigns = (context.extra?.campaigns ?? []) as CampaignSummary[]
  const hasStagedFunnel = (context.extra?.hasStagedFunnel === true) || ((s.addToCart ?? 0) > 0)

  const from = context.dateRange.from instanceof Date
    ? context.dateRange.from.toISOString().slice(0, 10)
    : String(context.dateRange.from).slice(0, 10)
  const to = context.dateRange.to instanceof Date
    ? context.dateRange.to.toISOString().slice(0, 10)
    : String(context.dateRange.to).slice(0, 10)

  const lines: string[] = []

  lines.push(`## Google Ads Performance: ${from} to ${to}`)
  lines.push(`Data: ${context.daily.length} days with spend data.\n`)

  // --- Overall Performance ---
  lines.push('### Overall Performance')
  lines.push(`- Total Spend: ₹${fmt(s.totalSpend)}${pctChange(comparison, 'totalSpend')}`)
  lines.push(`- Conversion Value (attributed revenue): ₹${fmt(s.totalConversionValue)}${pctChange(comparison, 'totalConversionValue')}`)
  lines.push(`- ROAS: ${fmt(s.roas, 2)}x${pctChange(comparison, 'roas')}`)
  lines.push(`- Impressions: ${fmt(s.totalImpressions)}${pctChange(comparison, 'totalImpressions')}`)
  lines.push(`- Clicks: ${fmt(s.totalClicks)} | CTR: ${fmt(s.ctr, 2)}%${pctChange(comparison, 'ctr')}`)
  lines.push(`- CPC: ₹${fmt(s.cpc)}`)
  lines.push(`- Conversions: ${fmt(s.totalConversions)} | CVR: ${fmt(s.overallCvr, 2)}%\n`)

  if (p.totalSpend != null && p.totalSpend > 0) {
    lines.push(`Prior period: Spend ₹${fmt(p.totalSpend)} | Conv. Value ₹${fmt(p.totalConversionValue)} | ROAS ${fmt(p.roas, 2)}x\n`)
  }

  // --- Acquisition vs Retention Split ---
  lines.push('### Acquisition vs Retention Split')
  const acqPct = s.acqSpendPct ?? 0
  const retPct = 100 - acqPct
  lines.push(`- Acquisition campaigns: ${fmt(acqPct, 1)}% of spend (₹${fmt(s.acqSpend)}) → ROAS ${fmt(s.acqRoas, 2)}x`)
  lines.push(`- Retention/branded/other: ${fmt(retPct, 1)}% of spend (₹${fmt(s.retSpend)}) → ROAS ${fmt(s.retRoas, 2)}x`)
  lines.push(`Note: High branded ROAS inflating blended ROAS is common — check if acq campaigns are profitable standalone.\n`)

  // --- Funnel Analysis ---
  lines.push('### Funnel Analysis')
  if (hasStagedFunnel) {
    lines.push(`Funnel coverage: staged (ADD_TO_CART, CHECKOUT_INITIATED, PURCHASE conversion actions tracked)`)
    lines.push(`${fmt(s.totalImpressions)} impressions → ${fmt(s.totalClicks)} clicks (CTR ${fmt(s.ctr, 2)}%) → ${fmt(s.addToCart)} ATC (${fmt(s.atcRatePct, 1)}% of clicks) → ${fmt(s.checkoutInitiated)} checkout (${fmt(s.checkoutPerAtcPct, 1)}% of ATC) → ${fmt(s.totalConversions)} purchases (${fmt(s.purchasePerCheckoutPct, 1)}% of checkout)`)
    lines.push(`- Cost per ATC: ₹${fmt(s.costPerAtc)} | Cost per purchase: ₹${fmt(s.costPerPurchase)}`)
    lines.push(`- Overall CVR: ${fmt(s.overallCvr, 2)}%`)
  } else {
    lines.push(`Funnel coverage: aggregate only (no staged conversion actions). Conversions = purchases tracked by Google.`)
    lines.push(`- Clicks: ${fmt(s.totalClicks)} | Conversions: ${fmt(s.totalConversions)} | CVR: ${fmt(s.overallCvr, 2)}% | Cost per conversion: ₹${fmt(s.costPerPurchase)}`)
    lines.push(`Tip: Enable ADD_TO_CART and CHECKOUT conversion actions in Google Ads for richer funnel data.`)
  }
  lines.push('')

  // --- Campaign Performance ---
  if (campaigns.length > 0) {
    lines.push('### Top Campaigns (by spend)')
    if (hasStagedFunnel && campaigns.some(c => c.hasStagedFunnel)) {
      lines.push('name | intent | spend | ROAS | CTR% | ATC% | CI/ATC% | Purch/CI% | CVR%')
      for (const c of campaigns) {
        lines.push(`${c.name} | ${c.intent} | ₹${fmt(c.spend)} | ${fmt(c.roas, 2)}x | ${fmt(c.ctr, 2)} | ${c.atcRate != null ? fmt(c.atcRate, 1) : '—'} | ${c.checkoutFromAtc != null ? fmt(c.checkoutFromAtc, 1) : '—'} | ${c.purchaseFromCheckout != null ? fmt(c.purchaseFromCheckout, 1) : '—'} | ${fmt(c.overallCvr, 2)}`)
      }
    } else {
      lines.push('name | intent | spend | ROAS | CTR% | CPC | conversions | CVR%')
      for (const c of campaigns) {
        lines.push(`${c.name} | ${c.intent} | ₹${fmt(c.spend)} | ${fmt(c.roas, 2)}x | ${fmt(c.ctr, 2)} | ₹${fmt(c.cpc)} | ${fmt(c.conversions)} | ${fmt(c.overallCvr, 2)}`)
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
  lines.push('date|spend|convVal|roas|impressions|clicks|conversions')
  for (const d of context.daily) {
    lines.push(`${d.date}|${d.spend}|${d.conversionValue}|${d.roas}|${d.impressions}|${d.clicks}|${d.conversions}`)
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
1. **ROAS efficiency** — Is blended ROAS healthy? Is it driven by branded campaigns masking poor acquisition ROAS?
2. **Acquisition vs Retention balance** — Branded keywords often inflate ROAS. Identify if true acquisition ROAS justifies the spend.
3. **Funnel quality** — Where is the conversion drop-off? High CTR + low CVR = landing page/offer mismatch. Low CTR = ad copy or keyword mismatch.
4. **CPC trends** — Rising CPC signals auction competition or Quality Score degradation. Recommend bid strategy adjustments.
5. **Campaign-level winners/losers** — Which campaigns are scaling efficiently? Which should be paused, restructured, or budget-shifted?
6. **Keyword intent signals** — If campaigns have mixed intents (brand + acquisition), budget allocation may be suboptimal.
7. **Scaling opportunity** — Which acquisition campaigns have stable ROAS above target and room for budget increase?

Be specific. Name campaigns. Prioritize insights that directly affect profitability and customer acquisition efficiency.`)

  return lines.join('\n')
}
