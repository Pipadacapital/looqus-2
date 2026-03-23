'use client'

import { useState, useEffect, useMemo } from 'react'
import { format, startOfYear, endOfDay } from 'date-fns'
import Link from 'next/link'
import {
  IconSpeakerphone,
  IconLoader2,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { DateRangeFilter } from '@/components/analytics'
import { formatCurrency } from '@/components/analytics/types'
import type { GoalEvaluation } from '@/lib/metrics/goals'
import type { GoalMetricId } from '@/lib/metrics/goal-metrics-registry'
import { KpiGoalLine } from '@/components/goals/kpi-goal-line'
import { usePageInsights } from '@/hooks/use-page-insights'
import { InsightSheet } from '@/components/ai-engine/insight-sheet'
import {
  ChartContainer,
  type ChartConfig,
} from '@/components/ui/chart'
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Cell, Tooltip, LineChart } from 'recharts'

const TOOLTIP_LABELS: Record<string, string> = {
  ncCm2: 'NC CM2',
  adSpend: 'Ad Spend',
  cm2PerNc: 'CM2 per NC',
  blendedCac: 'Blended CAC',
}

const TOOLTIP_COLORS: Record<string, string> = {
  ncCm2: '#22c55e',
  adSpend: 'hsl(24 95% 53%)',
  cm2PerNc: 'hsl(0 0% 9%)',
  blendedCac: 'hsl(221 83% 53%)',
}

function AcquisitionChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean
  payload?: Array<{ name: string; dataKey: string; value: number; color: string }>
  label?: string
  currency: string
}) {
  if (!active || !payload?.length || !label) return null
  const dateLabel = format(new Date(String(label) + 'T00:00:00'), 'MMM d, yyyy')
  return (
    <div className="border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{dateLabel}</div>
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.dataKey && item.value !== undefined)
          .map((item) => (
            <div
              key={item.dataKey}
              className="flex w-full items-center gap-2"
            >
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: TOOLTIP_COLORS[item.dataKey] ?? item.color }}
              />
              <span className="text-muted-foreground min-w-[4.5rem]">
                {TOOLTIP_LABELS[item.dataKey] ?? item.name}
              </span>
              <span className="font-mono font-medium tabular-nums">
                {typeof item.value === 'number' ? formatCurrency(item.value, currency) : String(item.value)}
              </span>
            </div>
          ))}
      </div>
    </div>
  )
}

type MarketingEfficiency = {
  totalAdSpend: number
  storeNetRevenue: number
  mer: number | null
  newCustomerRevenue: number
  acquisitionAdSpend: number
  aMer: number | null
  acos: number | null
}

type AcquisitionSummary = {
  cm2: number
  newCustomers: number
  cm2PerNc: number
  meta: number
  google: number
  totalAdSpend: number
  blendedCac: number
  marketingEfficiency: MarketingEfficiency
  goalEvaluations?: Partial<Record<GoalMetricId, GoalEvaluation>>
}

type AcquisitionDailyRow = {
  date: string
  ncCm2: number
  adSpend: number
  cm2PerNc: number
  blendedCac: number
  newCustomers: number
  meta: number
  google: number
}

type AcquisitionTrendRow = {
  date: string
  ma90: number
  ma180: number
  ma365: number
}

type AcquisitionCompositionSummary = {
  discountsPct: number
  cm2Pct: number
  adSpendPct: number
  cogsPct: number
  variableCostsPct: number
  refundsPct: number
}

type AcquisitionCompositionDailyRow = {
  date: string
  ncContributionMarginPct: number
  adSpendPct: number
  cogsPct: number
  variableCostsPct: number
  refundsPct: number
  discountPct: number
}

function applyYtdPreset(
  onFrom: (s: string) => void,
  onTo: (s: string) => void
) {
  const now = new Date()
  onFrom(format(startOfYear(now), 'yyyy-MM-dd'))
  onTo(format(endOfDay(now), 'yyyy-MM-dd'))
}

const chartConfig = {
  ncCm2: { label: 'NC CM2', color: 'hsl(var(--chart-1))' },
  adSpend: { label: 'Ad Spend', color: 'hsl(24 95% 53%)' },
  cm2PerNc: { label: 'CM2 per NC', color: 'hsl(0 0% 9%)' },
  blendedCac: { label: 'Blended CAC', color: 'hsl(221 83% 53%)' },
} satisfies ChartConfig

const emptyMarketing: MarketingEfficiency = {
  totalAdSpend: 0,
  storeNetRevenue: 0,
  mer: null,
  newCustomerRevenue: 0,
  acquisitionAdSpend: 0,
  aMer: null,
  acos: null,
}

interface AcquisitionContentProps {
  workspaceSlug: string
  workspaceName: string
  hasShopifyConnection: boolean
}

export function AcquisitionContent({
  workspaceSlug,
  workspaceName,
  hasShopifyConnection,
}: AcquisitionContentProps) {
  const now = new Date()
  const ytdFrom = format(startOfYear(now), 'yyyy-MM-dd')
  const ytdTo = format(endOfDay(now), 'yyyy-MM-dd')

  const [from, setFrom] = useState(ytdFrom)
  const [to, setTo] = useState(ytdTo)
  const [data, setData] = useState<{
    summary: AcquisitionSummary
    daily: AcquisitionDailyRow[]
    currency: string
    trend: AcquisitionTrendRow[]
    composition: { summary: AcquisitionCompositionSummary; daily: AcquisitionCompositionDailyRow[] }
  } | null>(null)
  const [loading, setLoading] = useState(!!workspaceSlug && !!from && !!to)
  const [error, setError] = useState<string | null>(null)

  // AI Insight — global job store
  const insightProps = usePageInsights(workspaceSlug, 'acquisition', from, to)

  const handleFromChange = (value: string) => {
    setFrom(value)
    setLoading(true)
    setError(null)
  }

  const handleToChange = (value: string) => {
    setTo(value)
    setLoading(true)
    setError(null)
  }

  const handleApplyYtd = () => {
    applyYtdPreset(handleFromChange, handleToChange)
  }

  useEffect(() => {
    if (!workspaceSlug || !from || !to) return
    fetch(`/api/workspaces/${workspaceSlug}/acquisition?from=${from}&to=${to}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error)
          setData(null)
        } else {
          setData({
            summary: (() => {
              const s = json.summary ?? {}
              const me = { ...emptyMarketing, ...(s.marketingEfficiency ?? {}) }
              return {
                cm2: Number(s.cm2) || 0,
                newCustomers: Number(s.newCustomers) || 0,
                cm2PerNc: Number(s.cm2PerNc) || 0,
                meta: Number(s.meta) || 0,
                google: Number(s.google) || 0,
                totalAdSpend: Number(s.totalAdSpend) || 0,
                blendedCac: Number(s.blendedCac) || 0,
                marketingEfficiency: me,
                goalEvaluations: s.goalEvaluations as
                  | AcquisitionSummary['goalEvaluations']
                  | undefined,
              }
            })(),
            daily: json.daily ?? [],
            currency: json.currency ?? 'INR',
            trend: json.trend ?? [],
            composition: json.composition ?? { summary: { discountsPct: 0, cm2Pct: 0, adSpendPct: 0, cogsPct: 0, variableCostsPct: 0, refundsPct: 0 }, daily: [] },
          })
        }
      })
      .catch(() => {
        setError('Failed to load acquisition data')
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [workspaceSlug, from, to])

  const currency = data?.currency ?? 'INR'

  if (!hasShopifyConnection) {
    return (
      <div className="flex flex-col gap-6 py-4 md:py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconSpeakerphone className="h-6 w-6 text-[#96bf48]" />
            Acquisition
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{workspaceName}</p>
        </div>
        <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
          Connect Shopify to view acquisition metrics.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconSpeakerphone className="h-6 w-6 text-[#96bf48]" />
            Acquisition
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Everything on this page is calculated by allocating refunds and variable costs to the order date, not the refunded date. This is to prevent your metrics from looking good on all days except for the days you process refunds.
          </p>
        </div>

        {hasShopifyConnection && (
          <InsightSheet
            page="acquisition"
            from={from}
            to={to}
            sheetOpen={insightProps.sheetOpen}
            onSheetOpenChange={insightProps.setSheetOpen}
            insights={insightProps.insights}
            loading={insightProps.loading}
            error={insightProps.error}
            cached={insightProps.cached}
            model={insightProps.model}
            dataThrough={insightProps.dataThrough}
            insufficientData={insightProps.insufficientData}
            isDone={insightProps.isDone}
            onGenerate={insightProps.generate}
            pageLoading={loading}
          />
        )}
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-4 border-b px-6 py-4">
          <DateRangeFilter
            from={from}
            to={to}
            onFromChange={handleFromChange}
            onToChange={handleToChange}
            fromId="acquisition-from"
            toId="acquisition-to"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={handleApplyYtd}
          >
            Year to date
          </Button>
        </div>

        <div className="p-6 space-y-6">
          <h2 className="text-lg font-semibold tracking-tight">
            New Customer Contribution Margin 2
          </h2>

          {loading ? (
            <div className="flex justify-center py-16">
              <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-4">{error}</p>
          ) : data ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">CM2</p>
                  <p className={data.summary.cm2 < 0 ? 'text-destructive font-medium' : 'font-medium'}>
                    {formatCurrency(data.summary.cm2, currency)}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">New Customers</p>
                  <p className="font-medium tabular-nums">{data.summary.newCustomers.toLocaleString('en-IN')}</p>
                  {data.summary.goalEvaluations?.new_customers ? (
                    <KpiGoalLine
                      metricId="new_customers"
                      evaluation={data.summary.goalEvaluations.new_customers}
                      currency={currency}
                    />
                  ) : null}
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">CM2 per NC</p>
                  <p className={data.summary.cm2PerNc < 0 ? 'text-destructive font-medium' : 'font-medium'}>
                    {formatCurrency(data.summary.cm2PerNc, currency)}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Meta</p>
                  <p className="font-medium">{formatCurrency(data.summary.meta, currency)}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Google</p>
                  <p className="font-medium">{formatCurrency(data.summary.google, currency)}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Total Ad Spend</p>
                  <p className="font-medium">{formatCurrency(data.summary.totalAdSpend, currency)}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Blended CAC</p>
                  <p className="font-medium">{formatCurrency(data.summary.blendedCac, currency)}</p>
                  {data.summary.goalEvaluations?.cac ? (
                    <KpiGoalLine
                      metricId="cac"
                      evaluation={data.summary.goalEvaluations.cac}
                      currency={currency}
                    />
                  ) : null}
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">MER</p>
                  <p className="font-medium tabular-nums">
                    {data.summary.marketingEfficiency.mer != null
                      ? `${data.summary.marketingEfficiency.mer.toFixed(2)}×`
                      : '—'}
                  </p>
                  {data.summary.goalEvaluations?.mer ? (
                    <KpiGoalLine
                      metricId="mer"
                      evaluation={data.summary.goalEvaluations.mer}
                      currency={currency}
                    />
                  ) : null}
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">aMER</p>
                  <p className="font-medium tabular-nums">
                    {data.summary.marketingEfficiency.aMer != null
                      ? `${data.summary.marketingEfficiency.aMer.toFixed(2)}×`
                      : '—'}
                  </p>
                  {data.summary.goalEvaluations?.amer ? (
                    <KpiGoalLine
                      metricId="amer"
                      evaluation={data.summary.goalEvaluations.amer}
                      currency={currency}
                    />
                  ) : null}
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">ACOS</p>
                  <p className="font-medium tabular-nums">
                    {data.summary.marketingEfficiency.acos != null
                      ? `${data.summary.marketingEfficiency.acos.toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                MER = store net revenue ÷ total ad spend (same as blended ROAS). aMER = new-customer
                revenue ÷ acquisition-tagged spend only.{' '}
                <Link
                  href={`/w/${workspaceSlug}/settings/ad-campaigns`}
                  className="underline font-medium text-foreground"
                >
                  Classify campaigns
                </Link>{' '}
                for aMER.
              </p>

              {data.daily.length > 0 && (
                <AcquisitionChartBlock daily={data.daily} currency={currency} chartConfig={chartConfig} />
              )}
            </>
          ) : null}
        </div>
      </div>

      {data && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            New Customer Acquisition Trend
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Your average new customers per day is a great crystal ball into the future. If it&apos;s decreasing, your revenue is expected to decrease in the future, too, all else equal.
          </p>
          <div className="rounded-xl border bg-card shadow-sm p-4">
            <AcquisitionTrendChart trend={data.trend} />
            <p className="text-xs text-muted-foreground mt-3">
              90, 180, and 365-day moving averages of daily new customer count. Uses available days if less than the full period of data exists.
            </p>
          </div>
        </div>
      )}

      {data && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            New Customer Order Composition
          </h2>
          <AcquisitionCompositionSection composition={data.composition} />
        </div>
      )}
    </div>
  )
}

function AcquisitionChartBlock({
  daily,
  currency,
  chartConfig,
}: {
  daily: AcquisitionDailyRow[]
  currency: string
  chartConfig: ChartConfig
}) {
  const domain = useMemo(() => {
    let min = 0
    let max = 0
    for (const row of daily) {
      min = Math.min(min, row.ncCm2, row.adSpend, row.cm2PerNc, row.blendedCac)
      max = Math.max(max, row.ncCm2, row.adSpend, row.cm2PerNc, row.blendedCac)
    }
    if (min === max) max = min + 1
    return [min, max] as [number, number]
  }, [daily])

  return (
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-4">
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="h-2.5 w-2.5 rounded-[2px] bg-[#22c55e]" />
                      NC CM2
                    </span>
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(24_95%_53%)]" />
                      Ad Spend
                    </span>
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(0_0%_9%)]" />
                      CM2 per NC
                    </span>
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(221_83%_53%)]" />
                      Blended CAC
                    </span>
                  </div>
                  <ChartContainer config={chartConfig} className="h-[360px] w-full">
                    <ComposedChart
                      data={daily}
                      margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => format(new Date(v + 'T00:00:00'), 'MMM d')}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        domain={domain}
                        tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                        tick={{ fontSize: 11 }}
                        width={48}
                      />
                      <Tooltip
                        content={
                          <AcquisitionChartTooltip
                            currency={currency}
                          />
                        }
                      />
                      <Bar
                        dataKey="ncCm2"
                        name="NC CM2"
                        radius={[2, 2, 0, 0]}
                        maxBarSize={32}
                      >
                        {daily.map((entry, index) => (
                          <Cell
                            key={index}
                            fill={entry.ncCm2 >= 0 ? '#22c55e' : '#ef4444'}
                          />
                        ))}
                      </Bar>
                      <Line
                        type="monotone"
                        dataKey="adSpend"
                        name="Ad Spend"
                        stroke="hsl(24 95% 53%)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="cm2PerNc"
                        name="CM2 per NC"
                        stroke="hsl(0 0% 9%)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="blendedCac"
                        name="Blended CAC"
                        stroke="hsl(221 83% 53%)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ChartContainer>
                </div>
  )
}

const TREND_COLORS = {
  ma90: 'hsl(24 95% 53%)',
  ma180: '#22c55e',
  ma365: 'hsl(221 83% 53%)',
}

function AcquisitionTrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number }>
  label?: string
}) {
  if (!active || !payload?.length || !label) return null
  const dateLabel = format(new Date(String(label) + 'T00:00:00'), 'MMM d, yyyy')
  const labels: Record<string, string> = { ma90: '90-Day MA', ma180: '180-Day MA', ma365: '365-Day MA' }
  return (
    <div className="border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{dateLabel}</div>
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.dataKey && item.value !== undefined)
          .map((item) => (
            <div key={item.dataKey} className="flex w-full items-center gap-2">
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: TREND_COLORS[item.dataKey as keyof typeof TREND_COLORS] }}
              />
              <span className="text-muted-foreground min-w-[5rem]">{labels[item.dataKey] ?? item.dataKey}</span>
              <span className="font-mono font-medium tabular-nums">{Number(item.value).toFixed(2)}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

const COMPOSITION_COLORS = {
  ncContributionMarginPct: '#22c55e',
  adSpendPct: 'hsl(24 95% 53%)',
  cogsPct: 'hsl(0 0% 9%)',
  variableCostsPct: 'hsl(262 83% 58%)',
  refundsPct: 'hsl(292 70% 70%)',
  discountPct: '#ef4444',
}

function CompositionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number }>
  label?: string
}) {
  if (!active || !payload?.length || !label) return null
  const dateLabel = format(new Date(String(label) + 'T00:00:00'), 'MMM d, yyyy')
  const labels: Record<string, string> = {
    ncContributionMarginPct: 'NC Contribution Margin',
    adSpendPct: 'Ad Spend',
    cogsPct: 'COGS',
    variableCostsPct: 'Variable Costs',
    refundsPct: 'Refunds',
    discountPct: 'Discount %',
  }
  return (
    <div className="border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{dateLabel}</div>
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.dataKey && item.value !== undefined)
          .map((item) => (
            <div key={item.dataKey} className="flex w-full items-center gap-2">
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: COMPOSITION_COLORS[item.dataKey as keyof typeof COMPOSITION_COLORS] }}
              />
              <span className="text-muted-foreground min-w-[7rem]">{labels[item.dataKey] ?? item.dataKey}</span>
              <span className="font-mono font-medium tabular-nums">{Number(item.value).toFixed(2)}%</span>
            </div>
          ))}
      </div>
    </div>
  )
}

function AcquisitionCompositionSection({
  composition,
}: {
  composition: { summary: AcquisitionCompositionSummary; daily: AcquisitionCompositionDailyRow[] }
}) {
  const { summary, daily } = composition
  const compConfig = {
    ncContributionMarginPct: { label: 'NC Contribution Margin', color: COMPOSITION_COLORS.ncContributionMarginPct },
    adSpendPct: { label: 'Ad Spend', color: COMPOSITION_COLORS.adSpendPct },
    cogsPct: { label: 'COGS', color: COMPOSITION_COLORS.cogsPct },
    variableCostsPct: { label: 'Variable Costs', color: COMPOSITION_COLORS.variableCostsPct },
    refundsPct: { label: 'Refunds', color: COMPOSITION_COLORS.refundsPct },
    discountPct: { label: 'Discount %', color: COMPOSITION_COLORS.discountPct },
  } satisfies ChartConfig

  const domain = useMemo(() => {
    if (!daily.length) return [-10, 100] as [number, number]
    let min = 0
    let max = 0
    for (const row of daily) {
      min = Math.min(min, row.ncContributionMarginPct, row.adSpendPct, row.cogsPct, row.variableCostsPct, row.refundsPct, row.discountPct)
      max = Math.max(max, row.ncContributionMarginPct, row.adSpendPct, row.cogsPct, row.variableCostsPct, row.refundsPct, row.discountPct)
    }
    const padding = Math.max(20, (max - min) * 0.1)
    return [Math.min(0, min - padding), Math.max(0, max + padding)] as [number, number]
  }, [daily])

  return (
    <>
      <div className="rounded-xl border bg-card shadow-sm p-4 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Discounts %</p>
            <p className="font-medium">{summary.discountsPct.toFixed(2)}%</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">CM2 %</p>
            <p className={`font-medium ${summary.cm2Pct < 0 ? 'text-blue-600' : ''}`}>{summary.cm2Pct.toFixed(2)}%</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Ad Spend %</p>
            <p className="font-medium">{summary.adSpendPct.toFixed(2)}%</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">COGS %</p>
            <p className="font-medium">{summary.cogsPct.toFixed(2)}%</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Variable Costs %</p>
            <p className="font-medium">{summary.variableCostsPct.toFixed(2)}%</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Refunds %</p>
            <p className="font-medium">{summary.refundsPct.toFixed(2)}%</p>
          </div>
        </div>
      </div>
      <div className="rounded-xl border bg-card shadow-sm p-4">
        <div className="mb-3 flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-[#22c55e]" />
            NC Contribution Margin
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(24_95%_53%)]" />
            Ad Spend
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(0_0%_9%)]" />
            COGS
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(262_83%_58%)]" />
            Variable Costs
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(292_70%_70%)]" />
            Refunds
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-[#ef4444]" />
            Discount %
          </span>
        </div>
        <ChartContainer config={compConfig} className="h-[320px] w-full">
          <LineChart data={daily} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => format(new Date(v + 'T00:00:00'), 'MMM d')}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              domain={domain}
              tick={{ fontSize: 11 }}
              width={40}
              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
            />
            <Tooltip content={<CompositionTooltip />} />
            <Line type="monotone" dataKey="ncContributionMarginPct" name="NC Contribution Margin" stroke={COMPOSITION_COLORS.ncContributionMarginPct} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="adSpendPct" name="Ad Spend" stroke={COMPOSITION_COLORS.adSpendPct} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="cogsPct" name="COGS" stroke={COMPOSITION_COLORS.cogsPct} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="variableCostsPct" name="Variable Costs" stroke={COMPOSITION_COLORS.variableCostsPct} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="refundsPct" name="Refunds" stroke={COMPOSITION_COLORS.refundsPct} strokeWidth={2} dot={false} strokeDasharray="4 2" />
            <Line type="monotone" dataKey="discountPct" name="Discount %" stroke={COMPOSITION_COLORS.discountPct} strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
        <p className="text-xs text-muted-foreground mt-3">
          All points in the graph are averages of the previous 7 days. This is to smooth out the data and make it easier to see trends instead of just daily fluctuations.
        </p>
      </div>
    </>
  )
}

function AcquisitionTrendChart({ trend }: { trend: AcquisitionTrendRow[] }) {
  const domain = useMemo(() => {
    if (!trend.length) return [0, 1] as [number, number]
    let max = 0
    for (const row of trend) {
      max = Math.max(max, row.ma90, row.ma180, row.ma365)
    }
    return [0, max + 0.5] as [number, number]
  }, [trend])

  const trendConfig = {
    ma90: { label: '90-Day MA', color: TREND_COLORS.ma90 },
    ma180: { label: '180-Day MA', color: TREND_COLORS.ma180 },
    ma365: { label: '365-Day MA', color: TREND_COLORS.ma365 },
  } satisfies ChartConfig

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-1.5 text-xs">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(24_95%_53%)]" />
          90-Day MA
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[#22c55e]" />
          180-Day MA
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(221_83%_53%)]" />
          365-Day MA
        </span>
      </div>
      <ChartContainer config={trendConfig} className="h-[320px] w-full">
        <LineChart data={trend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => format(new Date(v + 'T00:00:00'), 'MMM d')}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={domain}
            tick={{ fontSize: 11 }}
            width={36}
            tickFormatter={(v) => Number(v).toFixed(1)}
          />
          <Tooltip content={<AcquisitionTrendTooltip />} />
          <Line type="monotone" dataKey="ma90" name="90-Day MA" stroke={TREND_COLORS.ma90} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="ma180" name="180-Day MA" stroke={TREND_COLORS.ma180} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="ma365" name="365-Day MA" stroke={TREND_COLORS.ma365} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </>
  )
}
