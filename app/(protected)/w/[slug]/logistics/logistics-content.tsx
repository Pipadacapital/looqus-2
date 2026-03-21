'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { IconTruck, IconLoader2, IconPackage } from '@tabler/icons-react'
import { DateRangeFilter } from '@/components/analytics'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type LogisticsByCourier = {
  courierName: string
  count: number
  deliveredCount: number
  rtoCount: number
  totalCharges: number
}

type LogisticsByPaymentMethod = {
  paymentMethod: 'COD' | 'Prepaid'
  count: number
}

type LogisticsResponse = {
  from: string
  to: string
  connected: boolean
  totalShipments: number
  deliveredCount: number
  deliveredPercent: number | null
  rtoCount: number
  rtoPercent: number | null
  codCount: number
  prepaidCount: number
  forwardCharges: number
  codCharges: number
  rtoCharges: number
  totalShiprocketCharges: number
  averageShippingChargePerShipment: number | null
  byCourier: LogisticsByCourier[]
  byPaymentMethod: LogisticsByPaymentMethod[]
}

function fmtInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

interface LogisticsContentProps {
  slug: string
  workspaceName: string
  initialFrom: string
  initialTo: string
}

export function LogisticsContent({
  slug,
  workspaceName,
  initialFrom,
  initialTo,
}: LogisticsContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<LogisticsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/logistics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      const json: LogisticsResponse = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load logistics data')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [slug, from, to])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    setFrom(initialFrom)
    setTo(initialTo)
  }, [initialFrom, initialTo])

  const applyDateRange = () => {
    const params = new URLSearchParams()
    params.set('from', from)
    params.set('to', to)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconTruck className="h-7 w-7" />
          Logistics
        </h1>
        <p className="text-sm text-muted-foreground">
          Shiprocket operational reporting: logistics cost and fulfillment. Same shipment set and RTO definition as the Shiprocket page for this date range.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <DateRangeFilter
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          fromId="logistics-from"
          toId="logistics-to"
        />
        <Button size="sm" onClick={applyDateRange}>
          Apply
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <IconLoader2 className="h-5 w-5 animate-spin" />
          Loading logistics data…
        </div>
      )}

      {!loading && data && (
        <>
          {!data.connected && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              No Shiprocket connection. Connect Shiprocket in{' '}
              <a href={`/w/${slug}/settings/integrations`} className="font-medium underline underline-offset-2">
                Settings → Integrations
              </a>{' '}
              to see logistics data.
            </div>
          )}

          {data.connected && (
            <>
              {/* KPI cards — Row 1: volume & rates */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total Shipments
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">
                      {data.totalShipments.toLocaleString('en-IN')}
                    </span>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Delivered %
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">
                      {data.deliveredPercent != null ? `${data.deliveredPercent.toFixed(1)}%` : '—'}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {data.deliveredCount} of {data.totalShipments}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      RTO %
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums text-destructive">
                      {data.rtoPercent != null ? `${data.rtoPercent.toFixed(1)}%` : '—'}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {data.rtoCount} shipments
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      COD vs Prepaid
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-lg font-semibold tabular-nums">
                      {data.codCount} / {data.prepaidCount}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      COD · Prepaid
                    </p>
                  </CardContent>
                </Card>
              </div>
              {/* Row 2: charge breakdown */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Forward Charges
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">
                      {fmtInr(data.forwardCharges)}
                    </span>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      COD Charges
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">
                      {fmtInr(data.codCharges)}
                    </span>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      RTO Charges
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">
                      {fmtInr(data.rtoCharges)}
                    </span>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Shiprocket Charges
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">
                      {fmtInr(data.totalShiprocketCharges)}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Forward + COD + RTO
                    </p>
                    {data.averageShippingChargePerShipment != null && data.totalShipments > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Avg {fmtInr(data.averageShippingChargePerShipment)}/shipment
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* By Courier */}
              {data.byCourier.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <IconTruck className="h-4 w-4" />
                      By Courier
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Courier</TableHead>
                            <TableHead className="text-xs text-right">Shipments</TableHead>
                            <TableHead className="text-xs text-right">Delivered</TableHead>
                            <TableHead className="text-xs text-right">RTO</TableHead>
                            <TableHead className="text-xs text-right">Charges (₹)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.byCourier.map((row) => (
                            <TableRow key={row.courierName}>
                              <TableCell className="font-medium">{row.courierName}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.deliveredCount}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.rtoCount}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.totalCharges.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* By Payment Method */}
              {data.byPaymentMethod.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <IconPackage className="h-4 w-4" />
                      By Payment Method
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Payment</TableHead>
                            <TableHead className="text-xs text-right">Shipments</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.byPaymentMethod.map((row) => (
                            <TableRow key={row.paymentMethod}>
                              <TableCell className="font-medium">{row.paymentMethod}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {data.connected && data.totalShipments === 0 && (
                <p className="text-sm text-muted-foreground">
                  No shipments in this date range. Try a wider range or sync from Shiprocket.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
