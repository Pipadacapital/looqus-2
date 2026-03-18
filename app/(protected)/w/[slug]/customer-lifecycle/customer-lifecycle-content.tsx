'use client'

import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { IconLoader2 } from '@tabler/icons-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CustomerLifecycleReportPayload } from '@/lib/metrics/customer-lifecycle-report'
import type { LifecycleBucket } from '@/lib/metrics/customer-lifecycle'

const BUCKET_ORDER: LifecycleBucket[] = ['new', 'active', 'at_risk', 'churned']

const BUCKET_LABELS: Record<LifecycleBucket, string> = {
  new: 'New (1 order, recent)',
  active: 'Active (repeat, recent)',
  at_risk: 'At risk',
  churned: 'Churned',
}

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

export function CustomerLifecycleContent({ workspaceSlug, workspaceName }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [asOf, setAsOf] = useState(today)
  const [trainDays, setTrainDays] = useState('365')
  const [revenueDays, setRevenueDays] = useState('90')
  const [data, setData] = useState<CustomerLifecycleReportPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({
        asOf,
        trainDays,
        revenueDays,
      })
      const res = await fetch(`/api/workspaces/${workspaceSlug}/customer-lifecycle?${q}`)
      const json = await res.json()
      if (!res.ok) {
        setData(null)
        setError(json.error ?? res.statusText)
        return
      }
      setData(json as CustomerLifecycleReportPayload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug, asOf, trainDays, revenueDays])

  useEffect(() => {
    void load()
  }, [load])

  const totalCustomers = data
    ? BUCKET_ORDER.reduce((s, b) => s + data.counts[b], 0)
    : 0
  const totalRev = data
    ? BUCKET_ORDER.reduce((s, b) => s + data.revenueByBucket[b], 0)
    : 0

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customer lifecycle</h1>
        <p className="text-muted-foreground text-sm">
          {workspaceName} — buckets from repeat-gap thresholds (p40 / p80) and last order date.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Report parameters</CardTitle>
          <CardDescription>
            Thresholds use consecutive included orders in the training window. Classifications use
            lifetime included orders per customer as of the date below.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="asOf">As of (UTC end of day)</Label>
            <Input
              id="asOf"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="w-[180px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="train">Training window (days)</Label>
            <Input
              id="train"
              type="number"
              min={90}
              max={730}
              value={trainDays}
              onChange={(e) => setTrainDays(e.target.value)}
              className="w-[120px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev">Revenue window (days)</Label>
            <Input
              id="rev"
              type="number"
              min={7}
              max={365}
              value={revenueDays}
              onChange={(e) => setRevenueDays(e.target.value)}
              className="w-[120px]"
            />
          </div>
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

      {data && !error && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Net active</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{data.netActive}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs">
                New + active (within p40 days of last order).
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>p40 / p80 (days)</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {data.thresholds.p40Days} / {data.thresholds.p80Days}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs">
                {data.thresholds.usedFallback
                  ? `Fallback (fewer than ${data.thresholds.totalGaps} gaps in window).`
                  : `From ${data.thresholds.totalGaps} gaps · median gap ${data.thresholds.medianRepeatGapDays}d · ${data.thresholds.repeatCustomerCount} repeat customers in window.`}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>At risk + churned</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {data.counts.at_risk + data.counts.churned}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs">
                Share of base:{' '}
                {totalCustomers > 0
                  ? `${(((data.counts.at_risk + data.counts.churned) / totalCustomers) * 100).toFixed(1)}%`
                  : '—'}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  Revenue ({data.revenueWindowDays}d, {data.currency ?? '—'})
                </CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {fmtMoney(totalRev, data.currency)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs">
                Attributed by customer bucket; guest/unmapped excluded below.
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By bucket</CardTitle>
              <CardDescription>
                Customers: all-time included orders per Shopify customer id. Revenue: included orders
                in the trailing revenue window.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bucket</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">% of customers</TableHead>
                    <TableHead className="text-right">Orders ({data.revenueWindowDays}d)</TableHead>
                    <TableHead className="text-right">Revenue ({data.revenueWindowDays}d)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {BUCKET_ORDER.map((b) => {
                    const pct =
                      totalCustomers > 0 ? (100 * data.counts[b]) / totalCustomers : 0
                    const revPct =
                      totalRev > 0 ? (100 * data.revenueByBucket[b]) / totalRev : 0
                    return (
                      <TableRow key={b}>
                        <TableCell>{BUCKET_LABELS[b]}</TableCell>
                        <TableCell className="text-right tabular-nums">{data.counts[b]}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct.toFixed(1)}%</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {data.orderCountByBucket[b]}
                          {totalRev > 0 && (
                            <span className="text-muted-foreground ml-1 text-xs">
                              ({revPct.toFixed(0)}% rev)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtMoney(data.revenueByBucket[b], data.currency)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {(data.unattributedOrderCount > 0 || data.unattributedRevenue > 0) && (
                <p className="text-muted-foreground mt-4 text-sm">
                  Unattributed (no customer id or not in base):{' '}
                  {data.unattributedOrderCount} orders, {fmtMoney(data.unattributedRevenue, data.currency)}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">How it works</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground space-y-2 text-sm">
              <p>
                <strong>Gaps</strong>: For each customer, calendar days between consecutive included
                orders where both orders fall in the training window. <strong>p40</strong> /{' '}
                <strong>p80</strong> are inclusive linear-interpolated percentiles on those gaps
                (or 45d / 120d if too few gaps).
              </p>
              <p>
                <strong>Repeat customers</strong> (≥2 orders): active if last order ≤ p40 days ago;
                at_risk if p40 &lt; days ≤ p80; churned if &gt; p80.
              </p>
              <p>
                <strong>Single-order customers</strong>: new if last order ≤ p40d; at_risk / churned
                use the same p80 cutoffs.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
