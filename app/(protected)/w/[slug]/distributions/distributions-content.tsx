'use client'

import { useState, useEffect, useCallback } from 'react'
import { format, startOfYear, endOfDay } from 'date-fns'
import {
  IconChartBar,
  IconLoader2,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateRangeFilter } from '@/components/analytics'
import { formatCurrency } from '@/components/analytics/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts'
import type { DistributionsMetric, DistributionsSortColumn } from '@/lib/distributions/compute'

type DistributionsTableRow = {
  product: string
  orders: number
  mode: number
  mean: number
  diff: number
}

type DistributionsData = {
  rows: DistributionsTableRow[]
  totalRows: number
  currency: string
  distributionValues: number[]
  globalMode: number
  globalMean: number
  graphPoints: { value: number; density: number }[]
}

interface DistributionsContentProps {
  workspaceSlug: string
  workspaceName: string
}

function applyYtdPreset(onFrom: (s: string) => void, onTo: (s: string) => void) {
  const now = new Date()
  onFrom(format(startOfYear(now), 'yyyy-MM-dd'))
  onTo(format(endOfDay(now), 'yyyy-MM-dd'))
}

const chartConfig = {
  value: { label: 'Value', color: 'hsl(0 0% 9%)' },
  density: { label: 'Density', color: 'hsl(0 0% 9%)' },
}

export function DistributionsContent({ workspaceSlug, workspaceName }: DistributionsContentProps) {
  const now = new Date()
  const ytdFrom = format(startOfYear(now), 'yyyy-MM-dd')
  const ytdTo = format(endOfDay(now), 'yyyy-MM-dd')

  const [from, setFrom] = useState(ytdFrom)
  const [to, setTo] = useState(ytdTo)
  const [metric, setMetric] = useState<DistributionsMetric>('cm1')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [sort, setSort] = useState<DistributionsSortColumn>('orders')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [data, setData] = useState<DistributionsData | null>(null)
  const [loading, setLoading] = useState(!!workspaceSlug && !!from && !!to)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!workspaceSlug || !from || !to) return
    const params = new URLSearchParams({
      from,
      to,
      metric,
      sort,
      dir,
      page: String(page),
      pageSize: String(pageSize),
    })
    if (searchDebounced.trim()) params.set('search', searchDebounced.trim())
    setLoading(true)
    setError(null)
    fetch(`/api/workspaces/${workspaceSlug}/distributions?${params}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error)
          setData(null)
        } else {
          setData({
            rows: json.rows ?? [],
            totalRows: json.totalRows ?? 0,
            currency: json.currency ?? 'INR',
            distributionValues: json.distributionValues ?? [],
            globalMode: json.globalMode ?? 0,
            globalMean: json.globalMean ?? 0,
            graphPoints: json.graphPoints ?? [],
          })
        }
      })
      .catch(() => {
        setError('Failed to load distributions')
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [workspaceSlug, from, to, metric, sort, dir, page, pageSize, searchDebounced])

  const handleApplyYtd = useCallback(() => {
    applyYtdPreset(setFrom, setTo)
    setPage(1)
    setLoading(true)
    setError(null)
  }, [])

  const toggleSort = useCallback((col: DistributionsSortColumn) => {
    setSort(col)
    setDir((d) => (sort === col && d === 'desc' ? 'asc' : 'desc'))
    setPage(1)
  }, [sort])

  const totalPages = Math.max(1, data ? Math.ceil(data.totalRows / pageSize) : 1)
  const currency = data?.currency ?? 'INR'
  const modeLabel = metric === 'cm1' ? 'CM1 Mode' : 'Sales Mode'
  const meanLabel = metric === 'cm1' ? 'CM1 Mean' : 'Sales Mean'

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconChartBar className="h-6 w-6 text-[#96bf48]" />
          Distributions
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{workspaceName}</p>
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-4 border-b px-6 py-4">
          <DateRangeFilter
            from={from}
            to={to}
            onFromChange={(v) => { setFrom(v); setPage(1) }}
            onToChange={(v) => { setTo(v); setPage(1) }}
            fromId="distributions-from"
            toId="distributions-to"
          />
          <Button variant="outline" size="sm" className="h-8" onClick={handleApplyYtd}>
            Year to date
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            <Tabs value={metric} onValueChange={(v) => { setMetric(v as DistributionsMetric); setPage(1) }}>
              <TabsList className="h-8">
                <TabsTrigger value="cm1">CM1</TabsTrigger>
                <TabsTrigger value="sales">Sales</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Distribution graph */}
        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-16">
              <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-4">{error}</p>
          ) : data && data.graphPoints.length > 0 ? (
            <ChartContainer config={chartConfig} className="h-[280px] w-full">
              <LineChart
                data={data.graphPoints}
                margin={{ top: 12, right: 12, left: 8, bottom: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="value"
                  tickFormatter={(v) => formatCurrency(v, currency, { maximumFractionDigits: 0 })}
                  fontSize={11}
                />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Line
                  type="monotone"
                  dataKey="density"
                  stroke="hsl(0 0% 9%)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <ReferenceLine
                  x={data.globalMode}
                  stroke="hsl(0 0% 9%)"
                  strokeWidth={2}
                  label={{ value: `Mode: ${formatCurrency(data.globalMode, currency, { maximumFractionDigits: 0 })}`, position: 'top' }}
                />
                <ReferenceLine
                  x={data.globalMean}
                  stroke="hsl(0 0% 9%)"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  label={{ value: `Mean: ${formatCurrency(data.globalMean, currency, { maximumFractionDigits: 0 })}`, position: 'top' }}
                />
              </LineChart>
            </ChartContainer>
          ) : data ? (
            <div className="flex justify-center py-16 text-sm text-muted-foreground">
              No distribution data for the selected range.
            </div>
          ) : null}
        </div>

        <div className="px-6 py-3 border-t">
          <Input
            placeholder="Search products"
            className="max-w-xs"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-16">
              <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="px-6 py-8 text-sm text-destructive">{error}</p>
          ) : data ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">
                      <div className="flex items-center gap-1">
                        Product
                        <Button variant="ghost" size="icon" className="size-6" onClick={() => toggleSort('product')}>
                          {sort === 'product' ? (dir === 'desc' ? <IconArrowDown className="size-3.5" /> : <IconArrowUp className="size-3.5" />) : <IconArrowsSort className="size-3.5 text-muted-foreground" />}
                        </Button>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        Orders
                        <Button variant="ghost" size="icon" className="size-6" onClick={() => toggleSort('orders')}>
                          {sort === 'orders' ? (dir === 'desc' ? <IconArrowDown className="size-3.5" /> : <IconArrowUp className="size-3.5" />) : <IconArrowsSort className="size-3.5 text-muted-foreground" />}
                        </Button>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {modeLabel}
                        <Button variant="ghost" size="icon" className="size-6" onClick={() => toggleSort('mode')}>
                          {sort === 'mode' ? (dir === 'desc' ? <IconArrowDown className="size-3.5" /> : <IconArrowUp className="size-3.5" />) : <IconArrowsSort className="size-3.5 text-muted-foreground" />}
                        </Button>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {meanLabel}
                        <Button variant="ghost" size="icon" className="size-6" onClick={() => toggleSort('mean')}>
                          {sort === 'mean' ? (dir === 'desc' ? <IconArrowDown className="size-3.5" /> : <IconArrowUp className="size-3.5" />) : <IconArrowsSort className="size-3.5 text-muted-foreground" />}
                        </Button>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        Diff
                        <Button variant="ghost" size="icon" className="size-6" onClick={() => toggleSort('diff')}>
                          {sort === 'diff' ? (dir === 'desc' ? <IconArrowDown className="size-3.5" /> : <IconArrowUp className="size-3.5" />) : <IconArrowsSort className="size-3.5 text-muted-foreground" />}
                        </Button>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        No data for the selected filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((row, idx) => (
                      <TableRow key={`${row.product}-${idx}`}>
                        <TableCell className="font-medium align-top min-w-[200px]">
                          <span className="break-words" title={row.product}>
                            {row.product}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums align-top">
                          {row.orders.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums align-top">
                          {formatCurrency(row.mode, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums align-top">
                          {formatCurrency(row.mean, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums align-top">
                          {formatCurrency(row.diff, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between px-6 py-3 border-t">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Rows per page</span>
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
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(1)}>
                    «
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    ‹
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    ›
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>
                    »
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
