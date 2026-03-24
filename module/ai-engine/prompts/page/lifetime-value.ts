import type { PageContext } from '../../context-adapters/types'
import type { PeriodComparison } from '../../analysis/comparator'
import type { Anomaly } from '../../analysis/anomaly'
import type { TrendResult } from '../../analysis/trend'

const fmt = (n: number | null | undefined, prefix = '₹') =>
  n == null ? 'N/A' : `${prefix}${Math.round(n).toLocaleString('en-IN')}`

const pct = (n: number | null | undefined) =>
  n == null ? 'N/A' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`

const chg = (c: { changePercent: number | null } | undefined) =>
  c?.changePercent == null ? '' : ` (${c.changePercent > 0 ? '+' : ''}${c.changePercent.toFixed(1)}% vs prior)`

export function buildLtvPrompt(
  ctx: PageContext,
  comparison: PeriodComparison,
  anomalies: Anomaly[],
  _trends: TrendResult[]
): string {
  const s = ctx.summary
  const extra = ctx.extra as {
    topByM12: Array<{ label: string; nc: number; firstOrder: number; m3: number; m6: number; m12: number; retentionRatio: number }>
    bottomByM12: Array<{ label: string; nc: number; firstOrder: number; m3: number; m12: number }>
    ltvCurve: number[]
    totalProducts: number
  } | undefined

  const dateStr = `${ctx.dateRange.from.toISOString().slice(0, 10)} to ${ctx.dateRange.to.toISOString().slice(0, 10)}`
  const priorStr = `${ctx.priorDateRange.from.toISOString().slice(0, 10)} to ${ctx.priorDateRange.to.toISOString().slice(0, 10)}`
  const cur = ctx.currency

  // --- LTV curve section ---
  const curve = extra?.ltvCurve ?? []
  const curveStr = curve.length
    ? `M1=${fmt(curve[0], cur === 'INR' ? '₹' : '$')} → M2=${fmt(curve[1], '')} → M3=${fmt(curve[2], '')} → M4=${fmt(curve[3], '')} → M5=${fmt(curve[4], '')} → M6=${fmt(curve[5], '')} → M12=${fmt(curve[6], '')}`
    : 'Not available'

  // M3/M1 lift: how much value grows from first month to 3 months
  const m1ToM3Lift = s.m1ToM3Lift
  const m3ToM6Lift = s.m3ToM6Lift
  const m6ToM12Lift = s.m6ToM12Lift

  // --- Top products table ---
  const topTable = (extra?.topByM12 ?? [])
    .map(p =>
      `${p.label} | NC=${p.nc} | FO=${fmt(p.firstOrder, '')} | M3=${fmt(p.m3, '')} | M6=${fmt(p.m6, '')} | M12=${fmt(p.m12, '')} | RR=${p.retentionRatio.toFixed(2)}x`
    )
    .join('\n')

  // --- Bottom products table ---
  const bottomTable = (extra?.bottomByM12 ?? [])
    .map(p =>
      `${p.label} | NC=${p.nc} | FO=${fmt(p.firstOrder, '')} | M3=${fmt(p.m3, '')} | M12=${fmt(p.m12, '')}`
    )
    .join('\n')

  // --- Product anomalies ---
  const anomalyText = anomalies.length
    ? anomalies
        .slice(0, 4)
        .map(a => `Product "${a.date}" — ${a.metric} is ${a.direction} outlier (z=${a.zScore.toFixed(1)}, value=${a.value})`)
        .join('\n')
    : 'No product-level anomalies detected.'

  return `You are analyzing the Lifetime Value (LTV) page for an Indian D2C brand.

PERIOD: ${dateStr} | PRIOR PERIOD: ${priorStr}
NEW CUSTOMERS: ${s.newCustomers ?? 'N/A'}${chg(comparison.newCustomers)} acquired in this range

═══════════════════════════════════════
OVERALL LTV CURVE (avg CM2 cumulative per customer, product dimension)
═══════════════════════════════════════
${curveStr}

KEY MILESTONE COMPARISON (current vs prior period):
Metric        | Current                    | Prior                      | Change
First Order   | ${fmt(s.firstOrder)}       | ${fmt(ctx.priorSummary.firstOrder)} | ${chg(comparison.firstOrder)}
M1 Cumulative | ${fmt(s.month1)}           | ${fmt(ctx.priorSummary.month1)} | ${chg(comparison.month1)}
M3 Cumulative | ${fmt(s.month3)}           | ${fmt(ctx.priorSummary.month3)} | ${chg(comparison.month3)}
M6 Cumulative | ${fmt(s.month6)}           | ${fmt(ctx.priorSummary.month6)} | ${chg(comparison.month6)}
M12 Cumulative| ${fmt(s.month12)}          | ${fmt(ctx.priorSummary.month12)} | ${chg(comparison.month12)}

LTV VELOCITY (post-acquisition expansion):
M1→M3 growth  : ${pct(m1ToM3Lift)}${chg(comparison.m1ToM3Lift)}
M3→M6 growth  : ${pct(m3ToM6Lift)}${chg(comparison.m3ToM6Lift)}
M6→M12 growth : ${pct(m6ToM12Lift)}${chg(comparison.m6ToM12Lift)}

Note — all values are CM2 (contribution margin after COGS, shipping, packaging, website costs, ad spend).
This is realized per-customer value, not just revenue.

═══════════════════════════════════════
TOP 5 PRODUCTS BY M12 LTV (label | NC | FirstOrder CM2 | M3 | M6 | M12 | RetentionRatio)
RetentionRatio = M12/M1 — higher = customers keep buying after first purchase
═══════════════════════════════════════
${topTable || 'No product data available'}

═══════════════════════════════════════
BOTTOM 5 PRODUCTS BY M12 LTV (potential churn risk or margin destroyers)
═══════════════════════════════════════
${bottomTable || 'No product data available'}

═══════════════════════════════════════
PRODUCT-LEVEL ANOMALIES
═══════════════════════════════════════
${anomalyText}

TOTAL PRODUCTS ANALYZED: ${extra?.totalProducts ?? ctx.daily.length}

═══════════════════════════════════════
ANALYSIS INSTRUCTIONS
═══════════════════════════════════════
Generate 5-7 insights focused on:

1. LTV CURVE SHAPE — Is the curve steep (healthy early retention) or flat (one-and-done buyers)?
   Flag if M1→M3 growth < 20% (weak early retention) or > 80% (exceptional).

2. PAYBACK ANALYSIS — Can you estimate when CM2 cumulative likely covers CAC?
   If M3 cumulative > typical D2C CAC (₹500-1500), payback is fast. Flag if M12 < ₹1000 (poor LTV).

3. RETENTION QUALITY — Compare M6→M12 growth rate. If < 15%, customers largely stop after 6 months.
   If > 30%, strong long-tail retention worth investing in.

4. PRODUCT HEROES & ANCHORS — Which products drive highest LTV (best to acquire via)?
   Which products are low-LTV anchors despite high volume (bad unit economics at scale)?

5. RETENTION RATIO OUTLIERS — Products with retention ratio > 2x are "repeat magnets" — worth
   featuring in acquisition. Products with ratio < 1.1x are one-time purchases only.

6. PERIOD-OVER-PERIOD HEALTH — Is M12 LTV improving or declining vs prior period?
   Declining LTV is an early warning sign even if revenue looks healthy.

7. RECOMMENDATIONS — Specific actions:
   - Which products to prioritize in paid acquisition (best LTV)
   - Which products need a repurchase campaign (low retention ratio but decent first order)
   - Whether to invest more in retention vs acquisition based on LTV velocity

Indian D2C benchmarks for context:
- Good M3 CM2: ₹1,500+ | Excellent: ₹2,500+
- Good M12 CM2: ₹3,000+ | Excellent: ₹6,000+
- Healthy M1→M3 growth: 30-60%
- Healthy retention ratio (M12/M1): 1.5-3x for consumables, 1.1-1.8x for fashion/accessories

Respond ONLY with valid JSON:
{
  "insights": [
    {
      "title": "string (max 8 words)",
      "severity": "critical|warning|opportunity|positive",
      "confidence": 0-100,
      "summary": "1-2 sentence finding with specific numbers",
      "detail": "3-4 sentences of explanation with context and root cause",
      "recommendation": "1-2 specific, actionable steps with expected impact",
      "metrics": ["M12 LTV", "Retention Ratio", ...]
    }
  ]
}`
}
