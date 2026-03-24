'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { IconPackage, IconLoader2, IconTruck, IconCurrencyRupee } from '@tabler/icons-react'
import { DateRangeFilter } from '@/components/analytics'
import { Button } from '@/components/ui/button'
import { usePageInsights } from '@/hooks/use-page-insights'
import { InsightSheet } from '@/components/ai-engine/insight-sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type RtoAnalyticsResponse = {
  from: string
  to: string
  connected: boolean
  totalShipments: number
  rtoCount: number
  rtoRatePercent: number | null
  totalRtoCost: number
  revenueLostToRto: number
  byPaymentMethod: { paymentMethod: string; rtoCount: number; rtoCost: number; revenueLost: number }[]
  byCourier: { courierName: string; rtoCount: number; rtoCost: number; revenueLost: number }[]
  byProduct: { productTitle: string; quantity: number; revenueLost: number }[]
  rtoMappedCount: number
  rtoUnmappedCount: number
}

function fmtInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

interface RtoAnalyticsContentProps {
  slug: string
  workspaceName: string
  initialFrom: string
  initialTo: string
}

export function RtoAnalyticsContent({
  slug,
  workspaceName,
  initialFrom,
  initialTo,
}: RtoAnalyticsContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const insightProps = usePageInsights(slug, 'rto-analytics', initialFrom, initialTo)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<RtoAnalyticsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/rto-analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      const json: RtoAnalyticsResponse = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load RTO analytics')
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconPackage className="h-7 w-7" />
            RTO Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Return-to-origin overview: rate, cost, and revenue lost. Shiprocket-first: RTO definition and revenue lost
            use Shiprocket data only (COD amount or order total). No Shopify mapping required for main KPIs.
          </p>
        </div>
        <InsightSheet
          page="rto-analytics"
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

      <div className="flex flex-wrap items-center gap-3">
        <DateRangeFilter
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          fromId="rto-from"
          toId="rto-to"
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
          Loading RTO analytics…
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
              to see RTO analytics.
            </div>
          )}

          {data.connected && (
            <>
              {/* Overview cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      RTO rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums text-destructive">
                      {data.rtoRatePercent != null ? `${data.rtoRatePercent.toFixed(1)}%` : '—'}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {data.rtoCount} of {data.totalShipments} shipments
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total RTO orders
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">
                      {data.rtoCount.toLocaleString('en-IN')}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      RTO shipments
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total RTO cost
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">
                      {fmtInr(data.totalRtoCost)}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Shiprocket RTO charges
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <IconCurrencyRupee className="h-3.5 w-3.5" />
                      Revenue lost to RTO
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">
                      {fmtInr(data.revenueLostToRto)}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Shiprocket order/shipment value (COD amount or order total)
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* COD vs Prepaid RTO */}
              {data.byPaymentMethod.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">RTO by payment method</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Payment</TableHead>
                            <TableHead className="text-xs text-right">RTO count</TableHead>
                            <TableHead className="text-xs text-right">RTO cost</TableHead>
                            <TableHead className="text-xs text-right">Revenue lost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.byPaymentMethod.map((row) => (
                            <TableRow key={row.paymentMethod}>
                              <TableCell className="font-medium">{row.paymentMethod}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.rtoCount}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtInr(row.rtoCost)}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtInr(row.revenueLost)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* RTO by courier */}
              {data.byCourier.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <IconTruck className="h-4 w-4" />
                      RTO by courier
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Courier</TableHead>
                            <TableHead className="text-xs text-right">RTO count</TableHead>
                            <TableHead className="text-xs text-right">RTO cost</TableHead>
                            <TableHead className="text-xs text-right">Revenue lost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.byCourier.map((row) => (
                            <TableRow key={row.courierName}>
                              <TableCell className="font-medium">{row.courierName}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.rtoCount}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtInr(row.rtoCost)}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtInr(row.revenueLost)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* By product */}
              {data.byProduct.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">RTO by product (top 50)</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Line items from Shopify-mapped RTO orders; respects workspace filters.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Product</TableHead>
                            <TableHead className="text-xs text-right">Quantity</TableHead>
                            <TableHead className="text-xs text-right">Revenue lost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.byProduct.map((row) => (
                            <TableRow key={row.productTitle}>
                              <TableCell className="font-medium">{row.productTitle}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtInr(row.revenueLost)}</TableCell>
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
