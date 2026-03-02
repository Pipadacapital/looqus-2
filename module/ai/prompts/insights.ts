import type { WorkspaceMetricsContext } from '../types'

const fmt = (n: number, decimals = 0): string =>
  n.toLocaleString('en-IN', { maximumFractionDigits: decimals })
const pct = (n: number): string => `${n.toFixed(1)}%`
const currencySymbol = (c: string) => (c === 'INR' ? '₹' : '$')

/**
 * Build a concise text representation of workspace metrics for the LLM.
 * Includes summary + full daily breakdown for the selected period (all days from DB, CM1/CM2/CM3 per day).
 */
export function buildMetricsTextForInsights(ctx: WorkspaceMetricsContext): string {
  const lines: string[] = []
  const { period, summary, daily } = ctx
  const sym = summary ? currencySymbol(summary.currency) : '₹'

  lines.push(
    `Period: ${period.from} to ${period.to} (${period.days} days).`,
    ''
  )

  if (summary) {
    lines.push(
      '--- Summary (from database) ---',
      `Net sales: ${sym}${fmt(summary.totalNetSales)} | Gross: ${sym}${fmt(summary.totalGrossSales)}`,
      `Orders: ${summary.totalOrders} | AOV: ${sym}${fmt(summary.avgAov, 2)}`,
      `COGS: ${sym}${fmt(summary.totalCogs)} | Shipping: ${sym}${fmt(summary.totalShipping)} | Packaging: ${sym}${fmt(summary.totalPackaging)} | Website: ${sym}${fmt(summary.totalWebsiteCharges)}`,
      `CM1 (after variable costs): ${sym}${fmt(summary.cm1)}`,
      `Meta ad spend: ${sym}${fmt(summary.totalMetaAdSpend)} | Google ad spend: ${sym}${fmt(summary.totalGoogleAdSpend)} | Total ad spend: ${sym}${fmt(summary.totalAdSpend)}`,
      `CM2 (after ads): ${sym}${fmt(summary.cm2)} | Misc (prorated): ${sym}${fmt(summary.miscExpensesProrated)} | CM3: ${sym}${fmt(summary.cm3)}`,
      `Blended ROAS: ${summary.blendedRoas != null ? summary.blendedRoas.toFixed(2) + 'x' : 'N/A'} | ACOS: ${summary.acos != null ? pct(summary.acos) : 'N/A'}`,
      summary.totalSessions != null
        ? `Sessions: ${fmt(summary.totalSessions)} | Avg conversion rate: ${summary.avgConversionRate != null ? pct(summary.avgConversionRate * 100) : 'N/A'}`
        : '',
      summary.totalShipments != null && summary.rtoOrders != null
        ? `Shipments: ${summary.totalShipments} | RTO: ${summary.rtoOrders} (${summary.rtoPercent != null ? pct(summary.rtoPercent) : 'N/A'}) | RTO value: ${sym}${fmt(summary.rtoValue ?? 0)}`
        : '',
      summary.prepaidPercentage != null
        ? `Prepaid % of orders: ${pct(summary.prepaidPercentage)}`
        : '',
      ''
    )
  }

  if (daily.length > 0) {
    lines.push(`--- Daily breakdown (${daily.length} days, from database: date, net sales, orders, AOV, ad spend, CM1, CM2, CM3, RTO%, blended ROAS) ---`)
    for (const d of daily) {
      const roas = d.blendedRoas != null ? d.blendedRoas.toFixed(2) + 'x' : '-'
      const rtoP = d.rtoPercent != null ? pct(d.rtoPercent) : '-'
      lines.push(
        `${d.date}: ${sym}${fmt(d.netSales)} | ${d.ordersCount} orders | AOV ${sym}${fmt(d.aov, 2)} | Ad spend ${sym}${fmt(d.totalAdSpend)} | CM1 ${sym}${fmt(d.cm1)} | CM2 ${sym}${fmt(d.cm2)} | CM3 ${sym}${fmt(d.cm3)} | RTO% ${rtoP} | ROAS ${roas}`
      )
    }
  }

  return lines.filter(Boolean).join('\n')
}

const INSIGHTS_SYSTEM_PROMPT = `You are an e-commerce analytics assistant like Triple Whale. You analyze workspace metrics (sales, contribution margin, ad spend, ROAS, RTO, prepaid %) and produce 2 to 5 short, actionable insights.

Definitions:
- CM1 = profit after variable costs (COGS, shipping, packaging, website). CM2 = CM1 minus ad spend. CM3 = CM2 minus misc expenses.
- Blended ROAS = Net sales / Total ad spend. ACOS = (Total ad spend / Net sales) × 100.
- RTO = Return-to-origin (failed delivery) shipments. Prepaid % = share of orders paid upfront (non-COD).

Insight types to use when relevant (use exactly these insight_type values):
- performance_alert: overall performance issue (e.g. low ROAS, declining sales, margin squeeze)
- roas_drop: ROAS declining or below healthy level; suggest channel or creative fixes
- margin_risk: CM2 or CM3 at risk (high ad spend, low margin, or rising costs)
- ad_efficiency: how to improve ACOS, ROAS, or channel mix (Meta vs Google)
- sales_trend: notable trend in net sales or orders (up/down vs prior days)
- rto_alert: high RTO rate or RTO value; suggest delivery or verification improvements
- prepaid_trend: prepaid % notable; opportunity to push prepaid for better margins
- conversion_insight: sessions/conversion rate observation when data is present
- revenue_opportunity: clear opportunity (e.g. underinvested channel, high AOV segment)

Rules:
- Each insight must have: insight_type, title, reason, recommendation, confidence.
- title: short headline (e.g. "Blended ROAS below 2x"). reason: 1–2 sentences with numbers. recommendation: specific, actionable next step.
- confidence: 0.0 to 1.0. Optionally add severity: "high" | "medium" | "low" for urgency.
- Be concise. Reference actual numbers from the metrics (currency, ROAS, %, etc.).
- Output ONLY valid JSON: {"insights": [{"insight_type":"...", "title":"...", "reason":"...", "recommendation":"...", "confidence":0.85, "severity":"medium"}, ...]}. No markdown, no code fence.`

export function buildInsightsUserPrompt(ctx: WorkspaceMetricsContext): string {
  const metricsText = buildMetricsTextForInsights(ctx)
  return `Analyze these workspace metrics and return 2 to 5 insights as JSON.\n\n${metricsText}`
}

export { INSIGHTS_SYSTEM_PROMPT }
