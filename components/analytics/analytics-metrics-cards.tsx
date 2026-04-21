'use client'

import type { ShopifyAnalyticsSummary } from './types'
import { formatCurrency } from './types'
import type { GoalMetricId } from '@/lib/metrics/goal-metrics-registry'
import { KpiGoalLine } from '@/components/goals/kpi-goal-line'

export interface AnalyticsMetricsCardsProps {
  summary: ShopifyAnalyticsSummary
  className?: string
}

const otherCosts = (s: ShopifyAnalyticsSummary) =>
  s.totalShipping + s.totalPackaging + s.totalWebsiteCharges

const materialMargin = (s: ShopifyAnalyticsSummary) => s.totalNetSales - s.totalCogs
const materialMarginPercent = (s: ShopifyAnalyticsSummary) =>
  s.totalNetSales > 0 ? (materialMargin(s) / s.totalNetSales) * 100 : 0

const cm3Computed = (s: ShopifyAnalyticsSummary) =>
  s.cm3 ??
  (s.cm2 ?? s.cm1 - (s.totalAdSpend ?? 0)) - (s.miscExpensesTotal ?? 0)

export function AnalyticsMetricsCards({
  summary,
  className,
}: AnalyticsMetricsCardsProps) {
  const cm3 = cm3Computed(summary)

  const cards: {
    label: string
    value: string
    highlight?: boolean
    metricId?: GoalMetricId
  }[] = [
    { label: 'Gross sales', value: formatCurrency(summary.totalGrossSales, summary.currency) },
    {
      label: 'Net sales',
      value: formatCurrency(summary.totalNetSales, summary.currency),
      metricId: 'revenue',
    },
    { label: 'Discounts', value: formatCurrency(summary.totalDiscount, summary.currency) },
    { label: 'Tax', value: formatCurrency(summary.totalTax, summary.currency) },
    {
      label: 'Orders',
      value: summary.totalOrders.toLocaleString('en-IN'),
    },
    { label: 'COGS', value: formatCurrency(summary.totalCogs, summary.currency) },
    {
      label: 'Material Margin',
      value: formatCurrency(materialMargin(summary), summary.currency),
      highlight: true,
    },
    {
      label: 'Material Margin %',
      value: `${materialMarginPercent(summary).toFixed(1)}%`,
      highlight: true,
    },
    {
      label: 'Other costs',
      value: formatCurrency(otherCosts(summary), summary.currency),
    },
    {
      label: 'CM1',
      value: formatCurrency(summary.cm1, summary.currency),
      highlight: true,
    },
    {
      label: 'AOV',
      value: formatCurrency(summary.avgAov, summary.currency),
      metricId: 'aov',
    },
    {
      label: 'Prepaid orders %',
      value:
        summary.prepaidPercentage != null
          ? `${summary.prepaidPercentage.toFixed(1)}%`
          : '—',
    },
    {
      label: 'Meta Ad spend',
      value: formatCurrency(
        summary.metaAdSpend ?? 0,
        summary.metaAdCurrency ?? summary.currency
      ),
    },
    {
      label: 'Google Ad spend',
      value: formatCurrency(
        summary.googleAdSpend ?? 0,
        summary.googleAdCurrency ?? summary.currency
      ),
    },
    {
      label: 'Total Ad spend',
      value: formatCurrency(
        summary.totalAdSpend ?? 0,
        summary.totalAdCurrency ?? summary.currency
      ),
    },
    {
      label: 'CM2',
      value: formatCurrency(
        summary.cm2 ?? summary.cm1 - (summary.totalAdSpend ?? 0),
        summary.currency
      ),
      highlight: true,
    },
    {
      label: 'Misc. expenses',
      value: formatCurrency(summary.miscExpensesTotal ?? 0, summary.currency),
    },
    {
      label: 'CM3',
      value: formatCurrency(cm3, summary.currency),
      highlight: true,
      metricId: 'cm3',
    },
    {
      label: 'CM3 %',
      value:
        summary.cm3Pct != null
          ? `${summary.cm3Pct.toFixed(1)}%`
          : summary.totalNetSales > 0
            ? `${((cm3 / summary.totalNetSales) * 100).toFixed(1)}%`
            : '—',
      highlight: true,
      metricId: 'cm3_pct',
    },
    {
      label: 'MER',
      value:
        summary.mer != null ? `${summary.mer.toFixed(2)}×` : '—',
      highlight: true,
      metricId: 'mer',
    },
    {
      label: 'ACOS',
      value: summary.acos != null ? `${summary.acos.toFixed(1)}%` : '—',
      metricId: 'acos',
    },
  ]

  if (summary.totalShipmentsInRange != null && summary.totalShipmentsInRange > 0) {
    cards.push(
      {
        label: 'RTO Orders',
        value: (summary.rtoOrders ?? 0).toLocaleString('en-IN'),
      },
      {
        label: 'RTO %',
        value:
          summary.rtoPercent != null ? `${summary.rtoPercent.toFixed(1)}%` : '—',
      },
      {
        label:
          summary.rtoUnmapped && summary.rtoUnmapped > 0
            ? `RTO Value (${summary.rtoUnmapped} unmapped)`
            : 'RTO Value',
        value: formatCurrency(summary.rtoValue ?? 0, summary.currency),
      }
    )
  }

  if (summary.totalSessions != null) {
    cards.push({
      label: 'Sessions',
      value: summary.totalSessions.toLocaleString('en-IN'),
    })
  }
  if (summary.conversionRate != null) {
    const pct = Number(summary.conversionRate)
    cards.push({
      label: 'Conversion rate',
      value: pct <= 1 ? `${(pct * 100).toFixed(2)}%` : `${pct.toFixed(2)}%`,
    })
  }

  return (
    <div
      className={
        className ??
        'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
      }
    >
      {cards.map(({ label, value, highlight, metricId }) => {
        const ev =
          metricId && summary.goalEvaluations?.[metricId]
            ? summary.goalEvaluations[metricId]
            : undefined
        return (
          <div
            key={label}
            className={
              highlight
                ? 'rounded-lg border bg-[#96bf48]/10 p-4'
                : 'rounded-lg border bg-muted/30 p-4'
            }
          >
            <p
              className={
                highlight
                  ? 'text-xs font-bold text-[#96bf48] uppercase tracking-wider'
                  : 'text-xs text-muted-foreground uppercase tracking-wider'
              }
            >
              {label}
            </p>
            <p
              className={
                highlight
                  ? 'text-xl font-bold mt-0.5 text-[#96bf48]'
                  : 'text-xl font-semibold mt-0.5'
              }
            >
              {value}
            </p>
            {metricId && ev ? (
              <KpiGoalLine
                metricId={metricId}
                evaluation={ev}
                currency={summary.currency}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
