'use client'

import { useEffect, useMemo, useState } from 'react'

type MetricFormat = 'currency' | 'number' | 'percent' | 'multiplier'
type MetricCategory = 'Revenue' | 'Margins' | 'Marketing' | 'Logistics' | 'Store'

type MetricDef = {
  id: string
  label: string
  category: MetricCategory
  format: MetricFormat
}

const ALL_METRICS: MetricDef[] = [
  { id: 'grossSales', label: 'Gross Sales', category: 'Revenue', format: 'currency' },
  { id: 'netSales', label: 'Net Sales', category: 'Revenue', format: 'currency' },
  { id: 'discounts', label: 'Discounts', category: 'Revenue', format: 'currency' },
  { id: 'tax', label: 'Tax', category: 'Revenue', format: 'currency' },
  { id: 'orders', label: 'Orders', category: 'Revenue', format: 'number' },
  { id: 'aov', label: 'AOV', category: 'Revenue', format: 'currency' },
  { id: 'prepaidPct', label: 'Prepaid Orders %', category: 'Revenue', format: 'percent' },
  { id: 'cogs', label: 'COGS', category: 'Margins', format: 'currency' },
  { id: 'materialMargin', label: 'Material Margin', category: 'Margins', format: 'currency' },
  { id: 'materialMarginPct', label: 'Material Margin %', category: 'Margins', format: 'percent' },
  { id: 'variableCosts', label: 'Variable Costs', category: 'Margins', format: 'currency' },
  { id: 'otherCosts', label: 'Other Costs', category: 'Margins', format: 'currency' },
  { id: 'cm1', label: 'CM1', category: 'Margins', format: 'currency' },
  { id: 'cm2', label: 'CM2', category: 'Margins', format: 'currency' },
  { id: 'miscExpenses', label: 'Misc. Expenses', category: 'Margins', format: 'currency' },
  { id: 'cm3', label: 'CM3', category: 'Margins', format: 'currency' },
  { id: 'cm3Pct', label: 'CM3 %', category: 'Margins', format: 'percent' },
  { id: 'metaSpend', label: 'Meta Ad Spend', category: 'Marketing', format: 'currency' },
  { id: 'googleSpend', label: 'Google Ad Spend', category: 'Marketing', format: 'currency' },
  { id: 'totalAdSpend', label: 'Total Ad Spend', category: 'Marketing', format: 'currency' },
  { id: 'mer', label: 'MER', category: 'Marketing', format: 'multiplier' },
  { id: 'amer', label: 'aMER', category: 'Marketing', format: 'multiplier' },
  { id: 'acos', label: 'ACOS', category: 'Marketing', format: 'percent' },
  { id: 'rtoOrders', label: 'RTO Orders', category: 'Logistics', format: 'number' },
  { id: 'rtoPct', label: 'RTO %', category: 'Logistics', format: 'percent' },
  { id: 'totalRtoCost', label: 'Total RTO Cost', category: 'Logistics', format: 'currency' },
  { id: 'revenueLostToRto', label: 'Revenue Lost to RTO', category: 'Logistics', format: 'currency' },
  { id: 'codOrders', label: 'COD Orders', category: 'Logistics', format: 'number' },
  { id: 'codPct', label: 'COD %', category: 'Logistics', format: 'percent' },
  { id: 'codRevenue', label: 'COD Revenue', category: 'Logistics', format: 'currency' },
  { id: 'prepaidRevenue', label: 'Prepaid Revenue', category: 'Logistics', format: 'currency' },
  { id: 'sessions', label: 'Sessions', category: 'Store', format: 'number' },
  { id: 'conversionRate', label: 'Conversion Rate', category: 'Store', format: 'percent' },
]

const DEFAULT_CARDS = [
  'grossSales',
  'netSales',
  'orders',
  'aov',
  'cm1',
  'cm2',
  'cm3',
  'cm3Pct',
  'totalAdSpend',
  'mer',
  'amer',
  'acos',
  'rtoOrders',
  'rtoPct',
  'totalRtoCost',
  'revenueLostToRto',
  'codOrders',
  'codPct',
]

type Props = {
  workspaceSlug: string
  workspaceId: string
  from: string
  to: string
  analyticsData: { summary?: Record<string, unknown> | null } | null
  codData: Record<string, unknown> | null
  acquisitionData: Record<string, unknown> | null
  rtoData: Record<string, unknown> | null
  loading: boolean
  showCustomizePanel: boolean
}

function toNumber(value: unknown, fallback: number | null = 0): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

function formatValue(value: number | null, format: MetricFormat, currency: string): string {
  if (value == null) return '—'
  if (format === 'currency') {
    const symbol = currency === 'INR' ? '₹' : '$'
    return `${symbol}${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  }
  if (format === 'number') return value.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  if (format === 'multiplier') return `${value.toFixed(2)}x`
  return `${value.toFixed(2)}%`
}

export function DashboardMetricsGrid({
  workspaceSlug,
  workspaceId,
  from,
  to,
  analyticsData,
  codData,
  acquisitionData,
  rtoData,
  loading,
  showCustomizePanel,
}: Props) {
  const storageKey = useMemo(() => `brain_dashboard_cards_${workspaceId}`, [workspaceId])
  const [visibleCards, setVisibleCards] = useState<string[]>(DEFAULT_CARDS)
  const [warning, setWarning] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const valid = parsed.filter((id) => ALL_METRICS.some((m) => m.id === id))
      if (valid.length > 0) setVisibleCards(valid.slice(0, 20))
    } catch {
      setVisibleCards(DEFAULT_CARDS)
    }
  }, [storageKey])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(visibleCards))
  }, [storageKey, visibleCards])

  const toggleMetric = (id: string) => {
    setVisibleCards((prev) => {
      if (prev.includes(id)) {
        setWarning(null)
        return prev.filter((m) => m !== id)
      }
      if (prev.length >= 20) {
        setWarning('You can select up to 20 cards.')
        return prev
      }
      setWarning(null)
      return [...prev, id]
    })
  }

  const summary = (analyticsData?.summary ?? {}) as Record<string, unknown>
  const currency = (summary.currency as string) || 'INR'
  const acquisitionSummary =
    (acquisitionData?.summary as Record<string, unknown> | undefined) ?? undefined
  const marketingEfficiency =
    (acquisitionSummary?.marketingEfficiency as Record<string, unknown> | undefined) ??
    undefined

  const totalNetSales = toNumber(summary.totalNetSales)
  const totalCogs = toNumber(summary.totalCogs)
  const totalShipping = toNumber(summary.totalShipping)
  const totalPackaging = toNumber(summary.totalPackaging)
  const totalWebsiteCharges = toNumber(summary.totalWebsiteCharges)
  const variableCosts =
    (totalShipping ?? 0) + (totalPackaging ?? 0) + (totalWebsiteCharges ?? 0)
  const cm1 = toNumber(summary.totalCm1, toNumber(summary.cm1))
  const cm2 = toNumber(summary.totalCm2, toNumber(summary.cm2))
  const cm3 = toNumber(summary.totalCm3, toNumber(summary.cm3))
  const materialMargin = toNumber(
    summary.materialMargin,
    (totalNetSales ?? 0) - (totalCogs ?? 0)
  )
  const materialMarginPct = toNumber(
    summary.materialMarginPercent,
    (totalNetSales ?? 0) > 0 ? (((materialMargin ?? 0) / (totalNetSales ?? 0)) * 100) : 0
  )
  const codOrders = toNumber(codData?.codOrders)
  const prepaidOrders = toNumber(codData?.prepaidOrders)
  const totalCodPrepaid = (codOrders ?? 0) + (prepaidOrders ?? 0)
  const codPct = totalCodPrepaid > 0 ? (((codOrders ?? 0) / totalCodPrepaid) * 100) : 0
  const comparisonTable = (codData?.comparisonTable as Array<Record<string, unknown>> | undefined) ?? []
  const codRow = comparisonTable.find((r: any) => r.paymentMethod === 'COD')
  const prepaidRow = comparisonTable.find((r: any) => r.paymentMethod === 'Prepaid')

  const metricValues: Record<string, number | null> = {
    grossSales: toNumber(summary.totalGrossSales),
    netSales: totalNetSales,
    discounts: toNumber(summary.totalDiscount),
    tax: toNumber(summary.totalTax),
    orders: toNumber(summary.totalOrders),
    aov: toNumber(summary.avgAov),
    prepaidPct: toNumber(summary.prepaidOrdersPct, toNumber(summary.prepaidPercentage, 0)),
    cogs: totalCogs,
    materialMargin,
    materialMarginPct,
    variableCosts,
    otherCosts: variableCosts,
    cm1,
    cm2,
    miscExpenses: toNumber(summary.miscExpensesTotal),
    cm3,
    cm3Pct: toNumber(summary.cm3Pct),
    metaSpend: toNumber(summary.totalMetaSpend, toNumber(summary.metaAdSpend)),
    googleSpend: toNumber(summary.totalGoogleSpend, toNumber(summary.googleAdSpend)),
    totalAdSpend: toNumber(summary.totalAdSpend),
    mer: toNumber(summary.mer, null),
    amer: toNumber(marketingEfficiency?.aMer, null),
    acos: toNumber(summary.acos, null),
    rtoOrders: toNumber(rtoData?.rtoCount),
    rtoPct: toNumber(rtoData?.rtoRatePercent),
    totalRtoCost: toNumber(rtoData?.totalRtoCost),
    revenueLostToRto: toNumber(rtoData?.revenueLostToRto),
    codOrders,
    codPct,
    codRevenue: toNumber(codRow?.grossRevenue),
    prepaidRevenue: toNumber(prepaidRow?.grossRevenue),
    sessions: Number(summary.totalSessions) > 0 ? toNumber(summary.totalSessions) : null,
    conversionRate: Number(summary.conversionRate) > 0 ? toNumber(summary.conversionRate) : null,
  }

  const categories = useMemo(() => {
    const grouped: Record<MetricCategory, MetricDef[]> = {
      Revenue: [],
      Margins: [],
      Marketing: [],
      Logistics: [],
      Store: [],
    }
    for (const metric of ALL_METRICS) grouped[metric.category].push(metric)
    return grouped
  }, [])

  const cardsToRender = ALL_METRICS.filter((metric) => visibleCards.includes(metric.id))

  return (
    <div className="space-y-4">
      <div
        className={`overflow-hidden rounded-lg border bg-muted/20 transition-all duration-200 ${
          showCustomizePanel ? 'max-h-[700px] p-4 opacity-100' : 'max-h-0 p-0 opacity-0 border-0'
        }`}
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Customize dashboard cards</p>
          <p className="text-xs text-muted-foreground">
            {visibleCards.length}/20 selected
          </p>
        </div>
        {warning ? <p className="mb-2 text-xs text-amber-700">{warning}</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          {(Object.keys(categories) as MetricCategory[]).map((category) => (
            <div key={category} className="rounded-md border bg-background p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </p>
              <div className="space-y-1.5">
                {categories[category].map((metric) => (
                  <label key={metric.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={visibleCards.includes(metric.id)}
                      onChange={() => toggleMetric(metric.id)}
                    />
                    {metric.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div key={idx} className="rounded-lg border bg-muted/20 p-4">
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mt-3 h-7 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
          {cardsToRender.map((metric) => (
            <div key={metric.id} className="rounded-lg border bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {metric.label}
                </p>
                <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                  {metric.category}
                </span>
              </div>
              <p className="mt-1 text-xl font-semibold">
                {metricValues[metric.id] == null
                  ? '—'
                  : formatValue(metricValues[metric.id], metric.format, currency)}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Workspace: {workspaceSlug} · Range: {from} to {to}
      </p>
    </div>
  )
}
