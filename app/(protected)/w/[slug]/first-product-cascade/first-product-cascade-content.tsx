'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, startOfYear } from 'date-fns'
import { IconLoader2 } from '@tabler/icons-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DateRangeFilter } from '@/components/analytics'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { FirstProductCascadeResult, FirstProductCascadeRow } from '@/lib/metrics/first-product-cascade'

type SortKey =
  | 'productTitle'
  | 'firstOrderCustomers'
  | 'secondOrderRate'
  | 'thirdOrderRate'
  | 'fourthPlusRate'
  | 'additionalOrderRate'
  | 'averageLtv'
  | 'averageDaysToSecondOrder'

function fmtMoney(n: number, currency: string | null) {
  if (!currency) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(0)}`
  }
}

interface Props {
  workspaceSlug: string
  workspaceName: string
}

export function FirstProductCascadeContent({ workspaceSlug, workspaceName }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const yStart = format(startOfYear(new Date()), 'yyyy-MM-dd')
  const [from, setFrom] = useState(yStart)
  const [to, setTo] = useState(today)
  const [data, setData] = useState<FirstProductCascadeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('firstOrderCustomers')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ from, to, observationDays: '365' })
      const res = await fetch(`/api/workspaces/${workspaceSlug}/first-product-cascade?${q}`)
      const json = await res.json()
      if (!res.ok) {
        setData(null)
        const raw = (json.error as string | undefined) ?? res.statusText
        const noStore =
          json.code === 'NO_SHOPIFY' ||
          json.code === 'NO_WOOCOMMERCE' ||
          /no connected (shopify|woocommerce) store/i.test(raw)
        setError(noStore ? 'No connected store' : raw)
        return
      }
      setData(json as FirstProductCascadeResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug, from, to])

  useEffect(() => {
    void load()
  }, [load])

  const sortedRows = useMemo(() => {
    if (!data?.rows.length) return []
    const rows = [...data.rows]
    const dir = sortDir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      let va: number | string = 0
      let vb: number | string = 0
      switch (sortKey) {
        case 'productTitle':
          va = a.productTitle.toLowerCase()
          vb = b.productTitle.toLowerCase()
          return dir * String(va).localeCompare(String(vb))
        case 'firstOrderCustomers':
          va = a.firstOrderCustomers
          vb = b.firstOrderCustomers
          break
        case 'secondOrderRate':
          va = a.secondOrderRate
          vb = b.secondOrderRate
          break
        case 'thirdOrderRate':
          va = a.thirdOrderRate
          vb = b.thirdOrderRate
          break
        case 'fourthPlusRate':
          va = a.fourthPlusRate
          vb = b.fourthPlusRate
          break
        case 'additionalOrderRate':
          va = a.additionalOrderRate
          vb = b.additionalOrderRate
          break
        case 'averageLtv':
          va = a.averageLtv
          vb = b.averageLtv
          break
        case 'averageDaysToSecondOrder':
          va = a.averageDaysToSecondOrder ?? -1
          vb = b.averageDaysToSecondOrder ?? -1
          break
        default:
          return 0
      }
      return dir * (va > vb ? 1 : va < vb ? -1 : 0)
    })
    return rows
  }, [data, sortKey, sortDir])

  const funnel = useMemo(() => {
    if (!data?.totalCohortCustomers) return null
    const t = data.totalCohortCustomers
    let c2 = 0
    let c3 = 0
    let c4 = 0
    for (const r of data.rows) {
      c2 += r.customersWith2ndOrder
      c3 += r.customersWith3rdOrder
      c4 += r.customersWith4thPlusOrder
    }
    return {
      t,
      p2: (100 * c2) / t,
      p3: (100 * c3) / t,
      p4: (100 * c4) / t,
    }
  }, [data])

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir(k === 'productTitle' ? 'asc' : 'desc')
    }
  }

  const th = (k: SortKey, label: string, className?: string) => (
    <TableHead
      className={cn('cursor-pointer select-none hover:bg-muted/50', className)}
      onClick={() => toggleSort(k)}
    >
      {label}
      {sortKey === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </TableHead>
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">First product cascade</h1>
        <p className="text-muted-foreground text-sm">
          {workspaceName} — repeat behavior by primary product on the first order (cohort window).
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cohort window</CardTitle>
          <CardDescription>
            First orders in range; repeat &amp; LTV through {data?.observationEnd ?? '…'} (
            {data?.observationDaysAfterTo ?? 365}d after end date).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <IconLoader2 className="size-4 animate-spin" /> : 'Refresh'}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6 text-destructive text-sm">{error}</CardContent>
        </Card>
      )}

      {data && funnel && !error && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cohort funnel (all products)</CardTitle>
            <CardDescription>
              {funnel.t.toLocaleString()} new customers in window — share reaching 2nd / 3rd / 4th+ order
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            {[
              { label: '2nd order', pct: funnel.p2, color: 'bg-primary' },
              { label: '3rd order', pct: funnel.p3, color: 'bg-primary/70' },
              { label: '4th+ order', pct: funnel.p4, color: 'bg-primary/40' },
            ].map(({ label, pct, color }) => (
              <div key={label} className="min-w-[140px] flex-1">
                <div className="text-muted-foreground mb-1 text-xs">{label}</div>
                <div className="mb-1 text-lg font-semibold tabular-nums">{pct.toFixed(1)}%</div>
                <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                  <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data && !error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By primary first product</CardTitle>
            <CardDescription>
              One cohort per customer: highest line revenue on first order, then product id, then line id.
              LTV = mean revenue (included orders after first through observation end).
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {th('productTitle', 'Product')}
                  {th('firstOrderCustomers', '1st orders', 'text-right')}
                  {th('secondOrderRate', '2nd %', 'text-right')}
                  {th('thirdOrderRate', '3rd %', 'text-right')}
                  {th('fourthPlusRate', '4th+ %', 'text-right')}
                  {th('additionalOrderRate', "Add'l / cust", 'text-right')}
                  {th('averageLtv', 'Avg LTV', 'text-right')}
                  {th('averageDaysToSecondOrder', 'Avg days → 2nd', 'text-right')}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((r: FirstProductCascadeRow) => (
                  <TableRow key={r.productKey}>
                    <TableCell className="max-w-[280px] truncate font-medium" title={r.productTitle}>
                      {r.productTitle}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.firstOrderCustomers}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.secondOrderRate.toFixed(1)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{r.thirdOrderRate.toFixed(1)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{r.fourthPlusRate.toFixed(1)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{r.additionalOrderRate.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(r.averageLtv, data.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.averageDaysToSecondOrder != null ? r.averageDaysToSecondOrder : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {sortedRows.length === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm">No cohort customers in this window.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Semantics</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>
            <strong>Primary product</strong>: line with highest revenue (price × qty) on the first included
            order; ties broken by productShopifyId (nulls last), then line item id.
          </p>
          <p>
            <strong>Rates</strong>: % of cohort customers (by that product) with at least 2 / 3 / 4 included
            orders through the observation end.
          </p>
          <p>
            <strong>Add&apos;l / cust</strong>: average count of orders after the first. <strong>Avg LTV</strong>:
            mean of sum(order total) from first order through observation end (revenue, not CM2).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
