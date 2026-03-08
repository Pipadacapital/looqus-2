/**
 * Format FullAiContext into a concise text block for LLM prompts.
 */
import type { FullAiContext } from './types'

const fmt = (n: number, d = 0): string => n.toLocaleString('en-IN', { maximumFractionDigits: d })
const pct = (n: number): string => `${n.toFixed(1)}%`
const sym = (c: string) => (c === 'INR' ? '₹' : '$')

export function formatContextForPrompt(ctx: FullAiContext): string {
  const lines: string[] = []
  const { period, analytics, pnl, ads, orders, cohorts, timings, inventory, recentOrders } = ctx
  const s = sym(analytics.summary.currency)

  lines.push(`Period: ${period.from} to ${period.to} (${period.days} days)`, '')

  // ─── P&L Summary ────────────────────────────
  const p = pnl.summary
  lines.push(
    '══ P&L SUMMARY ══',
    `Gross Sales: ${s}${fmt(p.grossSales)} | Discounts: ${s}${fmt(p.discounts)} | Net Sales: ${s}${fmt(p.netSales)}`,
    `COGS: ${s}${fmt(p.cogs)} | Variable Costs: ${s}${fmt(p.variableCosts)}`,
    `CM1 (after variable): ${s}${fmt(p.cm1)} (${p.cm1Margin != null ? pct(p.cm1Margin) : 'N/A'})`,
    `Ad Spend: ${s}${fmt(p.adSpend)} (Meta: ${s}${fmt(p.metaAdSpend)}, Google: ${s}${fmt(p.googleAdSpend)})`,
    `CM2 (after ads): ${s}${fmt(p.cm2)} (${p.cm2Margin != null ? pct(p.cm2Margin) : 'N/A'})`,
    `Fixed Costs: ${s}${fmt(p.fixedCosts)} | Founder Salary: ${s}${fmt(p.founderSalary)}`,
    `CM3 (after fixed): ${s}${fmt(p.cm3)} (${p.cm3Margin != null ? pct(p.cm3Margin) : 'N/A'})`,
    `Net Profit: ${s}${fmt(p.netProfit)} (${p.netProfitMargin != null ? pct(p.netProfitMargin) : 'N/A'})`,
    `Orders: ${p.ordersCount}`,
    ''
  )

  // ─── Analytics Summary ────────────────────────────
  const a = analytics.summary
  lines.push(
    '══ ANALYTICS SUMMARY ══',
    `Avg AOV: ${s}${fmt(a.avgAov, 2)} | Total Orders: ${a.totalOrders}`,
    a.totalSessions != null ? `Sessions: ${fmt(a.totalSessions)} | Conv Rate: ${a.conversionRate != null ? pct(a.conversionRate * 100) : 'N/A'}` : '',
    a.prepaidPercentage != null ? `Prepaid %: ${pct(a.prepaidPercentage)}` : '',
    ''
  )

  // ─── Ads Summary ────────────────────────────
  const ad = ads.summary
  lines.push(
    '══ ADS PERFORMANCE ══',
    `Total Spend: ${s}${fmt(ad.totalSpend)} | Meta: ${s}${fmt(ad.metaSpend)} | Google: ${s}${fmt(ad.googleSpend)}`,
    `Blended ROAS: ${ad.blendedRoas != null ? ad.blendedRoas.toFixed(2) + 'x' : 'N/A'} | ACOS: ${ad.acos != null ? pct(ad.acos) : 'N/A'}`,
  )
  if (ad.topCampaigns.length > 0) {
    lines.push('Top campaigns by spend:')
    for (const c of ad.topCampaigns.slice(0, 5)) {
      lines.push(`  - ${c.campaignName} (${c.platform}): ${s}${fmt(c.spend)} | CPC: ${c.cpc != null ? s + fmt(c.cpc, 2) : '-'} | CTR: ${c.ctr != null ? pct(c.ctr) : '-'}`)
    }
  }
  lines.push('')

  // ─── Orders & RTO ────────────────────────────
  const o = orders.summary
  lines.push(
    '══ ORDERS & RTO ══',
    `Total Orders: ${o.totalOrders} | Prepaid: ${o.prepaidOrders} (${o.prepaidPercentage != null ? pct(o.prepaidPercentage) : 'N/A'}) | COD: ${o.codOrders}`,
    `RTO: ${o.rtoOrders} orders (${o.rtoPercent != null ? pct(o.rtoPercent) : 'N/A'}) | RTO Value: ${s}${fmt(o.rtoValue)} | Total Shipments: ${o.totalShipments}`,
    ''
  )

  // ─── Cohorts ────────────────────────────
  if (cohorts) {
    const c = cohorts.summary
    lines.push(
      '══ COHORT ANALYSIS ══',
      `New Customers: ${c.newCustomers} | Avg CAC: ${s}${fmt(c.averageCac, 2)}`,
      `90-Day Repeat Rate: ${pct(c.avg90DayRepeat)} | Avg Payback: ${c.averagePayback != null ? c.averagePayback.toFixed(1) + ' months' : 'N/A'}`,
      c.topCohortMonth ? `Best Cohort: ${c.topCohortMonth} (${c.topCohortRepeat != null ? pct(c.topCohortRepeat) : '-'} repeat)` : '',
      ''
    )
  }

  // ─── Timings ────────────────────────────
  if (timings) {
    const t = timings.summary
    lines.push(
      '══ REPURCHASE TIMINGS ══',
      `1st→2nd order: ${t.median1to2} days (${pct(t.secondOrdersPct)} return)`,
      `2nd→3rd order: ${t.median2to3} days (${pct(t.thirdOrdersPct)} return)`,
      `3rd→4th order: ${t.median3to4} days (${pct(t.fourthOrdersPct)} return)`,
      `Reactivation window: ${t.reactivationDays} days | First orders in range: ${t.firstOrders}`,
      ''
    )
  }

  // ─── Inventory ────────────────────────────
  if (inventory) {
    const i = inventory.summary
    lines.push(
      '══ INVENTORY HEALTH ══',
      `Products: ${i.totalProducts} | Variants: ${i.totalVariants} | Total Units: ${fmt(i.totalUnits)}`,
      `Healthy: ${i.healthyStockCount} | Low Stock: ${i.lowStockCount} | Dead Stock: ${i.deadStockCount} | Over Stock: ${i.overStockCount}`,
      `Avg Sell-Through (30d): ${i.avgSellThroughRate != null ? pct(i.avgSellThroughRate) : 'N/A'} | Avg Days Left: ${i.avgDaysLeft != null ? i.avgDaysLeft + ' days' : 'N/A'}`,
      ''
    )
  }

  // ─── Recent Orders ────────────────────────────
  if (recentOrders.length > 0) {
    lines.push(`══ RECENT ORDERS (last ${recentOrders.length}) ══`)
    for (const ro of recentOrders) {
      const customer = ro.customerName ?? ro.customerEmail ?? 'Unknown customer'
      const status = [ro.financialStatus, ro.fulfillmentStatus].filter(Boolean).join(' / ')
      lines.push(
        `${ro.processedAt} | ${ro.orderNumber} | ${customer} | ${ro.currency === 'INR' ? '₹' : '$'}${ro.totalPrice.toFixed(0)} | ${ro.itemCount} item(s) | ${status || 'N/A'}`
      )
    }
    lines.push('')
  }

  // ─── Daily Breakdown ────────────────────────────
  if (analytics.daily.length > 0) {
    lines.push(`══ DAILY BREAKDOWN (${analytics.daily.length} days) ══`)
    for (const d of analytics.daily) {
      lines.push(
        `${d.date}: Net ${s}${fmt(d.netSales)} | ${d.ordersCount} orders | AOV ${s}${fmt(d.aov, 2)} | COGS ${s}${fmt(d.cogs)} | CM1 ${s}${fmt(d.cm1)}`
      )
    }
  }

  return lines.filter(Boolean).join('\n')
}
