'use client'

import { useState, useEffect, useCallback } from 'react'
import { format, subDays } from 'date-fns'
import { IconChartBar, IconLoader2 } from '@tabler/icons-react'
import { DateRangeFilter } from '@/components/analytics'
import { usePageInsights } from '@/hooks/use-page-insights'
import { InsightSheet } from '@/components/ai-engine/insight-sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { BarChart, Bar, XAxis, YAxis, Cell, Tooltip } from 'recharts'
import type { WaterfallStep, CustomerFilter } from '@/app/api/workspaces/[slug]/waterfall/route'

type WaterfallResponse = {
  steps: WaterfallStep[]
  table: WaterfallStep[]
  currency: string
  shiprocketBreakdown?: {
    forwardCharges: number
    codCharges: number
    rtoCharges: number
  }
}

const CUSTOMER_FILTER_OPTIONS: { value: CustomerFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New Customers' },
  { value: 'returning', label: 'Returning Customers' },
]

const chartConfig = {
  revenue: { label: 'Revenue', color: 'hsl(142 76% 36%)' },
  cost: { label: 'Cost', color: 'hsl(0 84% 60%)' },
  subtotal: { label: 'Subtotal', color: 'hsl(221 83% 53%)' },
} satisfies ChartConfig

/** Waterfall page only: ISO currency from API + Intl (avoids shared formatCurrency INR vs $ shortcut). */
function formatWaterfallCurrency(
  value: number,
  currencyCode: string,
  options?: Intl.NumberFormatOptions
): string {
  const currency = currencyCode?.trim() || 'INR'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    ...options,
  }).format(value)
}

interface WaterfallContentProps {
  workspaceSlug: string
  workspaceName: string
}

/** Chart bar color by step type and value sign */
function barFill(step: WaterfallStep): string {
  if (step.type === 'subtotal') return 'hsl(221 83% 53%)' // blue for subtotals
  return step.value >= 0 ? 'hsl(142 76% 36%)' : 'hsl(0 84% 60%)'
}

export function WaterfallContent({
  workspaceSlug: slug,
  workspaceName,
}: WaterfallContentProps) {
  const [from, setFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const insightProps = usePageInsights(slug, 'waterfall', from, to)
  const [customerFilter, setCustomerFilter] = useState<CustomerFilter>('all')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<WaterfallResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const buildParams = useCallback(() => {
    const p = new URLSearchParams()
    p.set('from', from)
    p.set('to', to)
    p.set('customerFilter', customerFilter)
    return p.toString()
  }, [from, to, customerFilter])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/waterfall?${buildParams()}`
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? res.statusText)
      }
      const json: WaterfallResponse = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load waterfall')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [slug, buildParams])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Waterfall chart: running total; subtotal steps set the level (bar length 0)
  const chartData = (() => {
    if (!data?.steps?.length) return []
    let running = 0
    const starts: number[] = []
    for (const step of data.steps) {
      starts.push(running)
      if (step.type === 'subtotal') running = step.value
      else running += step.value
    }
    return data.steps.map((step, i) => {
      const start = starts[i]
      const isSubtotal = step.type === 'subtotal'
      const end = isSubtotal ? step.value : start + step.value
      return {
        ...step,
        label: step.label,
        id: step.id,
        start,
        value: isSubtotal ? 0 : step.value,
        end,
        displayValue: step.value,
      }
    })
  })()

  const currency = data?.currency ?? 'INR'
  const breakdown = data?.shiprocketBreakdown

  function renderTooltipContent(payload: { payload?: { formula: string; label: string; displayValue: number; id: string } }[]) {
    const p = payload?.[0]?.payload
    if (!p) return null
    const isShipping = p.id === 'shipping'
    const formula = isShipping && breakdown
      ? `Forward charges (${formatWaterfallCurrency(breakdown.forwardCharges, currency)}) + COD charges (${formatWaterfallCurrency(breakdown.codCharges, currency)}). Same source as Logistics.`
      : p.formula
    return (
      <div className="border-border bg-background grid min-w-[16rem] gap-1.5 rounded-lg border px-3 py-2 text-xs shadow-lg">
        <div className="font-medium">{p.label}</div>
        <div className="text-muted-foreground whitespace-normal">{formula}</div>
        <div className="pt-1 font-mono tabular-nums">
          {p.displayValue >= 0
            ? formatWaterfallCurrency(p.displayValue, currency, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : `-${formatWaterfallCurrency(Math.abs(p.displayValue), currency, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Contribution Margin Waterfall
          </h1>
          <p className="text-muted-foreground text-sm">
            Step-down from gross sales to net profit for {workspaceName}
          </p>
        </div>
        <InsightSheet
          page="waterfall"
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
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <DateRangeFilter
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          fromId="waterfall-from"
          toId="waterfall-to"
        />
        <Select
          value={customerFilter}
          onValueChange={(v) => setCustomerFilter(v as CustomerFilter)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Customer" />
          </SelectTrigger>
          <SelectContent>
            {CUSTOMER_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconChartBar className="h-4 w-4" />
                Waterfall
              </CardTitle>
              <p className="text-muted-foreground text-xs">
                Green = revenue, red = cost, blue = subtotal. Hover for formula.
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-[480px] w-full">
                <ChartContainer config={chartConfig} className="h-full w-full">
                  <BarChart
                    layout="vertical"
                    data={chartData}
                    margin={{ left: 4, right: 32, top: 8, bottom: 8 }}
                  >
                    <XAxis
                      type="number"
                      tickFormatter={(v) =>
                        formatWaterfallCurrency(v, currency, {
                          notation: 'compact',
                          compactDisplay: 'short',
                          maximumFractionDigits: 1,
                        })
                      }
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={160}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                    />
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.length ? renderTooltipContent(payload) : null
                      }
                    />
                    <Bar dataKey="start" stackId="wf" fill="transparent" />
                    <Bar dataKey="value" stackId="wf" radius={[0, 4, 4, 0]} minPointSize={2}>
                      {chartData.map((entry) => (
                        <Cell
                          key={entry.id}
                          fill={barFill(entry as WaterfallStep)}
                          stroke={entry.type === 'subtotal' ? 'hsl(221 83% 53%)' : undefined}
                          strokeWidth={entry.type === 'subtotal' ? 2 : 0}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Absolute values</CardTitle>
              <p className="text-muted-foreground text-xs">
                Hover a row to see the formula.
              </p>
            </CardHeader>
            <CardContent>
              <TooltipProvider delayDuration={300}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line item</TableHead>
                      <TableHead className="text-right">Amount ({currency})</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.table.map((row) => (
                      <UiTooltip key={row.id}>
                        <TooltipTrigger asChild>
                          <TableRow className="cursor-help">
                            <TableCell className="font-medium align-top">
                              <span className={row.type === 'subtotal' ? 'font-semibold' : ''}>
                                {row.label}
                              </span>
                            </TableCell>
                            <TableCell
                              className={`text-right tabular-nums align-top ${
                                row.value >= 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-red-600 dark:text-red-400'
                              } ${row.type === 'subtotal' ? 'font-semibold' : ''}`}
                            >
                              {row.value >= 0
                                ? formatWaterfallCurrency(row.value, currency, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })
                                : `-${formatWaterfallCurrency(Math.abs(row.value), currency, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}`}
                            </TableCell>
                          </TableRow>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                          {row.formula}
                        </TooltipContent>
                      </UiTooltip>
                    ))}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
