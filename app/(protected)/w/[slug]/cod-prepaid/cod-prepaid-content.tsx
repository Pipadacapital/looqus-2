'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { IconCash, IconLoader2, IconCurrencyRupee } from '@tabler/icons-react'
import { DateRangeFilter } from '@/components/analytics'
import { Button } from '@/components/ui/button'
import { usePageInsights } from '@/hooks/use-page-insights'
import { InsightSheet } from '@/components/ai-engine/insight-sheet'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type CodPrepaidResponse = {
  from: string
  to: string
  connected: boolean
  codOrders: number
  prepaidOrders: number
  codRealizationRatePercent: number | null
  codRtoRatePercent: number | null
  prepaidRtoRatePercent: number | null
  effectiveRevenueCod: number
  effectiveRevenuePrepaid: number
  prepaidPremium: number
  breakEvenCodRtoRatePercent: number | null
  breakEvenNote: string | null
  comparisonTable: {
    paymentMethod: string
    orders: number
    grossRevenue: number
    rtoRatePercent: number | null
    effectiveRevenue: number
    feeTotal: number
    netRevenue: number
    netRevenuePerOrder: number | null
  }[]
  averageOrderValue: number | null
  feesUsed?: { codFeePerOrder: number; gatewayFeePercent: number; returnShippingPerRto: number }
}

function fmtInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

interface CodPrepaidContentProps {
  slug: string
  workspaceName: string
  initialFrom: string
  initialTo: string
  initialCodFee?: string
  initialGatewayFee?: string
  initialReturnShipping?: string
}

export function CodPrepaidContent({
  slug,
  workspaceName,
  initialFrom,
  initialTo,
  initialCodFee = '30',
  initialGatewayFee = '2',
  initialReturnShipping = '80',
}: CodPrepaidContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [codFee, setCodFee] = useState(initialCodFee)
  const [gatewayFeePercent, setGatewayFeePercent] = useState(initialGatewayFee)
  const [returnShipping, setReturnShipping] = useState(initialReturnShipping)
  const insightProps = usePageInsights(slug, 'cod-prepaid', from, to)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<CodPrepaidResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const buildParams = useCallback(() => {
    const p = new URLSearchParams()
    p.set('from', from)
    p.set('to', to)
    const cf = parseFloat(codFee)
    const gf = parseFloat(gatewayFeePercent)
    const rs = parseFloat(returnShipping)
    if (Number.isFinite(cf)) p.set('codFeePerOrder', String(cf))
    if (Number.isFinite(gf)) p.set('gatewayFeePercent', String(gf))
    if (Number.isFinite(rs)) p.set('returnShippingPerRto', String(rs))
    return p.toString()
  }, [from, to, codFee, gatewayFeePercent, returnShipping])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/cod-prepaid-analytics?${buildParams()}`
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      const json: CodPrepaidResponse = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load COD vs Prepaid analytics')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [slug, buildParams])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    setFrom(initialFrom)
    setTo(initialTo)
  }, [initialFrom, initialTo])
  useEffect(() => {
    setCodFee(initialCodFee)
    setGatewayFeePercent(initialGatewayFee)
    setReturnShipping(initialReturnShipping)
  }, [initialCodFee, initialGatewayFee, initialReturnShipping])

  const applyFilters = () => {
    router.push(`${pathname}?${buildParams()}`)
  }

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconCash className="h-7 w-7" />
            COD vs Prepaid Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            India-specific economics: realization rate, RTO impact, effective revenue. Shiprocket-first
            payment and RTO. Set fees below to see effective revenue and break-even COD RTO rate.
          </p>
        </div>
        <InsightSheet
          page="cod-prepaid"
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

      <div className="flex flex-wrap items-end gap-4">
        <DateRangeFilter
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          fromId="cod-prepaid-from"
          toId="cod-prepaid-to"
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="cod-fee" className="text-xs">COD fee/order (₹)</Label>
            <Input
              id="cod-fee"
              type="number"
              min={0}
              step={1}
              value={codFee}
              onChange={(e) => setCodFee(e.target.value)}
              className="w-24"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gateway-fee" className="text-xs">Gateway fee %</Label>
            <Input
              id="gateway-fee"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={gatewayFeePercent}
              onChange={(e) => setGatewayFeePercent(e.target.value)}
              className="w-24"
            />
            <p className="text-[10px] text-muted-foreground">of prepaid gross revenue</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="return-shipping" className="text-xs">Return shipping/RTO (₹)</Label>
            <Input
              id="return-shipping"
              type="number"
              min={0}
              step={1}
              value={returnShipping}
              onChange={(e) => setReturnShipping(e.target.value)}
              className="w-24"
            />
          </div>
        </div>
        <Button size="sm" onClick={applyFilters}>
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
          Loading COD vs Prepaid analytics…
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
              to see COD vs Prepaid analytics.
            </div>
          )}

          {data.connected && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">COD orders</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">{data.codOrders.toLocaleString('en-IN')}</span>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Prepaid orders</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">{data.prepaidOrders.toLocaleString('en-IN')}</span>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">COD realization rate</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">
                      {data.codRealizationRatePercent != null ? `${data.codRealizationRatePercent.toFixed(1)}%` : '—'}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">Delivered / shipped COD</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">COD RTO rate</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums text-destructive">
                      {data.codRtoRatePercent != null ? `${data.codRtoRatePercent.toFixed(1)}%` : '—'}
                    </span>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Prepaid RTO rate</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums text-destructive">
                      {data.prepaidRtoRatePercent != null ? `${data.prepaidRtoRatePercent.toFixed(1)}%` : '—'}
                    </span>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <IconCurrencyRupee className="h-3.5 w-3.5" />
                      Effective revenue (COD)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">{fmtInr(data.effectiveRevenueCod)}</span>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <IconCurrencyRupee className="h-3.5 w-3.5" />
                      Effective revenue (Prepaid)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-2xl font-semibold tabular-nums">{fmtInr(data.effectiveRevenuePrepaid)}</span>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Prepaid premium</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className={`text-2xl font-semibold tabular-nums ${data.prepaidPremium >= 0 ? 'text-green-600 dark:text-green-500' : 'text-destructive'}`}>
                      {fmtInr(data.prepaidPremium)}
                    </span>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Break-even COD RTO rate</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.breakEvenCodRtoRatePercent != null ? (
                      <>
                        <span className="text-2xl font-semibold tabular-nums">
                          {data.breakEvenCodRtoRatePercent.toFixed(1)}%
                        </span>
                        <p className="text-xs text-muted-foreground mt-0.5">Above this, prepaid is better</p>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-muted-foreground">
                          {data.breakEvenNote ?? '—'}
                        </span>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              {data.feesUsed && (
                <p className="text-xs text-muted-foreground">
                  Fees used: COD ₹{data.feesUsed.codFeePerOrder}/order, Gateway {data.feesUsed.gatewayFeePercent}% of prepaid gross,
                  Return shipping ₹{data.feesUsed.returnShippingPerRto}/RTO
                </p>
              )}

              {data.comparisonTable.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Comparison</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Orders, gross revenue, RTO rate, effective revenue (after RTO loss and fees), fee total, net revenue per order.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Payment</TableHead>
                            <TableHead className="text-xs text-right">Orders</TableHead>
                            <TableHead className="text-xs text-right">Gross Revenue</TableHead>
                            <TableHead className="text-xs text-right">RTO Rate</TableHead>
                            <TableHead className="text-xs text-right">Effective Revenue</TableHead>
                            <TableHead className="text-xs text-right">Fee (COD ₹ or Gateway % + return)</TableHead>
                            <TableHead className="text-xs text-right">Net Revenue</TableHead>
                            <TableHead className="text-xs text-right">Net / Order</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.comparisonTable.map((row) => (
                            <TableRow key={row.paymentMethod}>
                              <TableCell className="font-medium">{row.paymentMethod}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.orders}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtInr(row.grossRevenue)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {row.rtoRatePercent != null ? `${row.rtoRatePercent.toFixed(1)}%` : '—'}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{fmtInr(row.effectiveRevenue)}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtInr(row.feeTotal)}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtInr(row.netRevenue)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {row.netRevenuePerOrder != null ? fmtInr(row.netRevenuePerOrder) : '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {data.connected && data.codOrders === 0 && data.prepaidOrders === 0 && (
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
