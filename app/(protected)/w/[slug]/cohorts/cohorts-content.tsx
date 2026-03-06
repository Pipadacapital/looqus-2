'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { format, subDays } from 'date-fns'
import { IconChartLine, IconLoader2 } from '@tabler/icons-react'
import { DateRangeFilter } from '@/components/analytics'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { CohortMetric, CohortMode, CohortRow, CohortsSummary } from '@/lib/cohorts/types'

const METRIC_LABELS: Record<CohortMetric, string> = {
  cm3: 'CM3',
  revenue: 'Revenue',
  repeat: 'Repeat Rate',
  repurchase: 'Repurchase Rate',
}

const MODE_LABELS: Record<CohortMode, string> = {
  post: 'Post-Acquisition',
  cumulative: 'Cumulative',
  incr: 'Incremental',
  pct: '%',
  ltvcac: 'LTV:CAC',
}

const DISABLED_METRIC_MODE: Record<CohortMetric, CohortMode[] | null> = {
  cm3: null,
  revenue: null,
  repeat: ['cumulative', 'pct', 'ltvcac'],
  repurchase: ['cumulative', 'pct', 'ltvcac'],
}

interface CohortsContentProps {
  workspaceSlug: string
  workspaceName: string
}

export function CohortsContent({ workspaceSlug, workspaceName }: CohortsContentProps) {
  const oneYearAgo = format(subDays(new Date(), 365), 'yyyy-MM-dd')
  const today = format(new Date(), 'yyyy-MM-dd')

  const [from, setFrom] = useState(oneYearAgo)
  const [to, setTo] = useState(today)
  const [metric, setMetric] = useState<CohortMetric>('cm3')
  const [mode, setMode] = useState<CohortMode>('post')
  const [data, setData] = useState<{
    summary: CohortsSummary
    rows: CohortRow[]
    currency: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabledModes = DISABLED_METRIC_MODE[metric] ?? []
  const effectiveMode = disabledModes.includes(mode) ? 'post' : mode

  const dataRef = useRef<{ from: string; to: string } | null>(null)

  useEffect(() => {
    if (!workspaceSlug || !from || !to) return
    setLoading(true)
    setError(null)
    const requestFrom = from
    const requestTo = to
    const requestMetric = metric
    const requestMode = effectiveMode
    fetch(
      `/api/workspaces/${workspaceSlug}/cohorts?from=${from}&to=${to}&metric=${metric}&mode=${effectiveMode}`
    )
      .then((res) => res.json())
      .then((d) => {
        if (d.error) {
          setError(d.error)
          setData(null)
          dataRef.current = null
          return
        }
        const isTabChangeOnly =
          dataRef.current &&
          dataRef.current.from === requestFrom &&
          dataRef.current.to === requestTo
        if (isTabChangeOnly) {
          setData((prev) =>
            prev
              ? { ...prev, rows: d.rows ?? [], currency: d.currency ?? prev.currency }
              : {
                  summary: d.summary,
                  rows: d.rows ?? [],
                  currency: d.currency ?? 'INR',
                }
          )
        } else {
          setData({
            summary: d.summary,
            rows: d.rows ?? [],
            currency: d.currency ?? 'INR',
          })
        }
        dataRef.current = { from: requestFrom, to: requestTo }
      })
      .catch(() => {
        setError('Failed to load cohorts')
        setData(null)
        dataRef.current = null
      })
      .finally(() => setLoading(false))
  }, [workspaceSlug, from, to, metric, effectiveMode])

  const summary = data?.summary
  const rows = data?.rows ?? []
  const currency = data?.currency ?? 'INR'

  const formatPayback = (v: number | null) => {
    if (v === null) return '—'
    if (v === 0) return 'Immediate'
    return `${v} mo`
  }

  const formatCurrency = (v: number) => {
    if (metric === 'repeat' || metric === 'repurchase') return (v * 100).toFixed(1) + '%'
    return new Intl.NumberFormat('en-IN', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(v))
  }

  const isPctLike = metric === 'repeat' || metric === 'repurchase' || effectiveMode === 'pct'

  const mCols = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'] as const
  const allMValues = useMemo(() => {
    const flat: number[] = []
    for (const r of rows) {
      for (const k of mCols) flat.push(r[k])
    }
    return flat
  }, [rows])
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

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconChartLine className="h-6 w-6 text-[#96bf48]" />
          Cohorts
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{workspaceName}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Tabs value={metric} onValueChange={(v) => setMetric(v as CohortMetric)}>
          <TabsList variant="line" className="gap-1">
            {(Object.keys(METRIC_LABELS) as CohortMetric[]).map((m) => (
              <TabsTrigger key={m} value={m}>
                {METRIC_LABELS[m]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tabs value={mode} onValueChange={(v) => setMode(v as CohortMode)}>
          <TabsList variant="line" className="gap-1">
            {(Object.keys(MODE_LABELS) as CohortMode[]).map((m) => (
              <TabsTrigger
                key={m}
                value={m}
                disabled={disabledModes.includes(m)}
                className={cn(disabledModes.includes(m) && 'opacity-50')}
              >
                {MODE_LABELS[m]}
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
              Average CAC
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold">
                ₹{formatCurrency(summary.averageCac)}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
              Avg 90-Day Repeat
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold">
                {(summary.avg90DayRepeat * 100).toFixed(1)}%
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 text-xs font-medium text-muted-foreground">
              Average Payback
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold">
                {summary.averagePayback != null ? `${summary.averagePayback.toFixed(1)} mo` : '—'}
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

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Cohort</TableHead>
                <TableHead>New Customers</TableHead>
                <TableHead>CAC</TableHead>
                <TableHead>90d RR</TableHead>
                <TableHead>Payback</TableHead>
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
                <TableRow key={r.cohortMonth}>
                  <TableCell className="font-medium">
                    {format(new Date(r.cohortMonth + '-01'), 'MMM yyyy')}
                  </TableCell>
                  <TableCell>{r.newCustomers}</TableCell>
                  <TableCell>₹{formatCurrency(r.cac)}</TableCell>
                    <TableCell>{(r.rr90 * 100).toFixed(1)}%</TableCell>
                    <TableCell className="whitespace-nowrap">{formatPayback(r.payback)}</TableCell>
                  <TableCell>₹{formatCurrency(r.firstOrderR)}</TableCell>
                  <TableCell>₹{formatCurrency(r.firstOrder)}</TableCell>
                  {mCols.map((k) => (
                    <TableCell
                      key={k}
                      className="text-center tabular-nums"
                      style={heatmapStyle(r[k])}
                    >
                      {isPctLike ? (r[k] * 100).toFixed(1) + '%' : formatCurrency(r[k])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {rows.length > 0 && (() => {
                const avg = rows.reduce(
                  (a, r) => ({
                    newCustomers: a.newCustomers + r.newCustomers,
                    cac: a.cac + r.cac * r.newCustomers,
                    rr90: a.rr90 + r.rr90 * r.newCustomers,
                    firstOrderR: a.firstOrderR + r.firstOrderR * r.newCustomers,
                    firstOrder: a.firstOrder + r.firstOrder * r.newCustomers,
                    m: mCols.map((k, i) => a.m[i] + r[k] * r.newCustomers),
                  }),
                  {
                    newCustomers: 0,
                    cac: 0,
                    rr90: 0,
                    firstOrderR: 0,
                    firstOrder: 0,
                    m: Array(12).fill(0),
                  }
                )
                const n = rows.length
                const totalN = avg.newCustomers
                return (
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell>Average</TableCell>
                    <TableCell>{Math.round(avg.newCustomers / n)}</TableCell>
                    <TableCell>
                      ₹{totalN ? formatCurrency(avg.cac / totalN) : '0'}
                    </TableCell>
                    <TableCell>
                      {totalN ? ((avg.rr90 / totalN) * 100).toFixed(1) : 0}%
                    </TableCell>
                    <TableCell>
                      {summary?.averagePayback != null ? `${summary.averagePayback.toFixed(1)} mo` : '—'}
                    </TableCell>
                    <TableCell>
                      ₹{totalN ? formatCurrency(avg.firstOrderR / totalN) : '0'}
                    </TableCell>
                    <TableCell>
                      ₹{totalN ? formatCurrency(avg.firstOrder / totalN) : '0'}
                    </TableCell>
                    {avg.m.map((s, i) => (
                      <TableCell
                        key={i}
                        className="text-center tabular-nums"
                        style={heatmapStyle(totalN ? s / totalN : 0)}
                      >
                        {isPctLike
                          ? (totalN ? (s / totalN) * 100 : 0).toFixed(1) + '%'
                          : formatCurrency(totalN ? s / totalN : 0)}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })()}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && !error && rows.length === 0 && data !== null && (
        <p className="text-muted-foreground text-sm">No cohort data for the selected range.</p>
      )}
    </div>
  )
}
