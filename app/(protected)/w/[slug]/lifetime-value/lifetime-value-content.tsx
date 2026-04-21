'use client'

import { useState, useEffect, useMemo } from 'react'
import { format, subDays, startOfYear, endOfDay } from 'date-fns'
import { IconLoader2, IconReport } from '@tabler/icons-react'
import { DateRangeFilter } from '@/components/analytics'
import { usePageInsights } from '@/hooks/use-page-insights'
import { InsightSheet } from '@/components/ai-engine/insight-sheet'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import type { LtvDimension, LtvMetric, LtvMode, LtvRow, LtvSummary } from '@/lib/ltv/types'

const METRIC_OPTIONS: { value: LtvMetric; label: string }[] = [
  { value: 'cm2', label: 'CM2' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'repeat_rate', label: 'Repeat Rate' },
]

const MODE_OPTIONS: { value: LtvMode; label: string }[] = [
  { value: 'cumulative', label: 'Cumulative' },
  { value: 'post_acq', label: 'Post-Acq' },
  { value: 'incremental', label: 'Incremental' },
]

const DIMENSION_OPTIONS: { value: LtvDimension; label: string }[] = [
  { value: 'product', label: 'Product' },
  { value: 'variant', label: 'Variant' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'collection', label: 'Collection' },
  { value: 'product_type', label: 'Product Type' },
  { value: 'product_tags', label: 'Product Tags' },
  { value: 'order_tags', label: 'Order Tags' },
  { value: 'discount_codes', label: 'Discount Codes' },
  { value: 'discount_pct', label: 'Discount %' },
  { value: 'customer_id', label: 'Customer ID' },
]

interface LifetimeValueContentProps {
  workspaceSlug: string
  workspaceName: string
}

export function LifetimeValueContent({
  workspaceSlug,
  workspaceName,
}: LifetimeValueContentProps) {
  const oneYearAgo = format(subDays(new Date(), 365), 'yyyy-MM-dd')
  const today = format(new Date(), 'yyyy-MM-dd')

  const [from, setFrom] = useState(oneYearAgo)
  const [to, setTo] = useState(today)
  const [metric, setMetric] = useState<LtvMetric>('cm2')
  const [dimension, setDimension] = useState<LtvDimension>('product')
  const [mode, setMode] = useState<LtvMode>('cumulative')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [data, setData] = useState<{
    summary: LtvSummary
    rows: LtvRow[]
    totalRows: number
    currency: string
  } | null>(null)
  const [loading, setLoading] = useState(() => !!workspaceSlug && !!from && !!to)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceSlug || !from || !to) return
    const params = new URLSearchParams({
      from,
      to,
      metric,
      mode,
      dimension,
      page: String(page),
      pageSize: String(pageSize),
    })
    if (search.trim()) params.set('search', search.trim())
    fetch(`/api/workspaces/${workspaceSlug}/lifetime-value?${params}`)
      .then((res) => res.json())
      .then((d) => {
        if (d.error) {
          setError(d.error)
          setData(null)
          return
        }
        setData({
          summary: d.summary ?? {
            firstOrderR: 0,
            firstOrder: 0,
            month1: 0,
            month3: 0,
            month6: 0,
            month12: 0,
            newCustomers: 0,
          },
          rows: d.rows ?? [],
          totalRows: d.totalRows ?? 0,
          currency: d.currency ?? 'INR',
        })
      })
      .catch(() => {
        setError('Failed to load lifetime value data')
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [workspaceSlug, from, to, metric, mode, dimension, page, pageSize, search])

  const summary = data?.summary
  const rows = data?.rows ?? []
  const totalRows = data?.totalRows ?? 0
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const dimensionLabel = DIMENSION_OPTIONS.find((d) => d.value === dimension)?.label ?? dimension

  const isRepeatRate = metric === 'repeat_rate'
  const currencyCode = data?.currency?.trim() || 'INR'

  const formatMoney = (v: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(Math.round(v))
    } catch {
      return `${currencyCode} ${Math.round(v)}`
    }
  }

  const formatValue = (v: number) => {
    if (isRepeatRate) return (v * 100).toFixed(1) + '%'
    return formatMoney(v)
  }

  const mCols = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'] as const
  const allMValues = useMemo(() => {
    const flat: number[] = []
    for (const r of rows) {
      for (const k of mCols) flat.push(r[k])
    }
    return flat
  }, [rows, mCols])
  const minM = useMemo(() => (allMValues.length ? Math.min(...allMValues) : 0), [allMValues])
  const maxM = useMemo(() => (allMValues.length ? Math.max(...allMValues) : 0), [allMValues])
  const rangeM = maxM - minM || 1

  const heatmapStyle = (value: number) => {
    const p = rangeM ? (value - minM) / rangeM : 0.5
    if (value >= 0) {
      const intensity = Math.min(1, p * 1.2)
      return { backgroundColor: `rgba(34, 197, 94, ${0.15 + intensity * 0.35})` }
    }
    const intensity = Math.min(1, (1 - p) * 1.2)
    return { backgroundColor: `rgba(239, 68, 68, ${0.1 + intensity * 0.25})` }
  }

  const insightProps = usePageInsights(workspaceSlug, 'lifetime-value', from, to)

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconReport className="h-6 w-6 text-[#96bf48]" />
            Lifetime Value
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{workspaceName}</p>
        </div>
        <InsightSheet
          page="lifetime-value"
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
          onFromChange={(v) => { setFrom(v); setPage(1) }}
          onToChange={(v) => { setTo(v); setPage(1) }}
          fromId="ltv-from"
          toId="ltv-to"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => {
            const now = new Date()
            setFrom(format(startOfYear(now), 'yyyy-MM-dd'))
            setTo(format(endOfDay(now), 'yyyy-MM-dd'))
            setPage(1)
          }}
        >
          Year to date
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Tabs value={metric} onValueChange={(v) => { setMetric(v as LtvMetric); setPage(1) }}>
          <TabsList variant="line" className="gap-1">
            {METRIC_OPTIONS.map((m) => (
              <TabsTrigger key={m.value} value={m.value}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          value={dimension}
          onValueChange={(v) => { setDimension(v as LtvDimension); setPage(1) }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Dimension" />
          </SelectTrigger>
          <SelectContent>
            {DIMENSION_OPTIONS.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tabs value={mode} onValueChange={(v) => { setMode(v as LtvMode); setPage(1) }}>
          <TabsList variant="line" className="gap-1">
            {MODE_OPTIONS.map((m) => (
              <TabsTrigger key={m.value} value={m.value}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <IconLoader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {summary && !loading && (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
          <Card>
            <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
              First Order (R)
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold">
                {isRepeatRate ? '100%' : formatValue(summary.firstOrderR)}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
              First Order
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold">
                {isRepeatRate ? '100%' : formatValue(summary.firstOrder)}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
              1 Month
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold">
                {isRepeatRate ? `${(summary.month1 * 100).toFixed(1)}%` : formatValue(summary.month1)}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
              3 Months
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold">
                {isRepeatRate ? `${(summary.month3 * 100).toFixed(1)}%` : formatValue(summary.month3)}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
              6 Months
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold">
                {isRepeatRate ? `${(summary.month6 * 100).toFixed(1)}%` : formatValue(summary.month6)}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
              12 Months
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold">
                {isRepeatRate ? `${(summary.month12 * 100).toFixed(1)}%` : formatValue(summary.month12)}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
              New Customers
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold">
                {summary.newCustomers.toLocaleString('en-IN')}
              </span>
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && (
        <div className="flex items-center gap-2">
          <Input
            placeholder={`Search ${dimensionLabel.toLowerCase()}`}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="max-w-xs"
          />
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px] min-w-[140px]">{dimensionLabel}</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>First Order (R)</TableHead>
                <TableHead>First Order</TableHead>
                {Array.from({ length: 12 }, (_, i) => (
                  <TableHead key={i} className="text-center min-w-[60px]">
                    M{i + 1}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.dimensionValue}>
                  <TableCell className="font-medium truncate max-w-[200px]" title={r.dimensionLabel}>
                    {r.dimensionLabel}
                  </TableCell>
                  <TableCell>{r.ordersCount}</TableCell>
                  <TableCell>
                    {isRepeatRate ? (r.firstOrderR * 100).toFixed(1) + '%' : formatValue(r.firstOrderR)}
                  </TableCell>
                  <TableCell>
                    {isRepeatRate ? (r.firstOrder * 100).toFixed(1) + '%' : formatValue(r.firstOrder)}
                  </TableCell>
                  {mCols.map((k) => (
                    <TableCell
                      key={k}
                      className="text-center tabular-nums"
                      style={heatmapStyle(r[k])}
                    >
                      {isRepeatRate ? (r[k] * 100).toFixed(1) + '%' : formatValue(r[k])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && totalRows > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t px-4 py-3">
          <p className="text-muted-foreground text-sm">
            {totalRows} row{totalRows !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="w-16 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 30, 50].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page <= 1}
              onClick={() => setPage(1)}
            >
              «
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              ›
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
            >
              »
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && rows.length === 0 && data !== null && (
        <p className="text-muted-foreground text-sm">No data for the selected filters.</p>
      )}
    </div>
  )
}
