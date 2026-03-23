'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { IconCash, IconLoader2, IconCurrencyRupee } from '@tabler/icons-react'
import { DateRangeFilter } from '@/components/analytics'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  TooltipProvider,
  Tooltip as UiTooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'

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
  initialReturnShipping?: string
}

export function CodPrepaidContent({
  slug,
  workspaceName,
  initialFrom,
  initialTo,
  initialCodFee = '30',
  initialReturnShipping = '80',
}: CodPrepaidContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [codFee, setCodFee] = useState(initialCodFee)
  const [returnShipping, setReturnShipping] = useState(initialReturnShipping)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<CodPrepaidResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const buildParams = useCallback(() => {
    const p = new URLSearchParams()
    p.set('from', from)
    p.set('to', to)
    const cf = parseFloat(codFee)
    const rs = parseFloat(returnShipping)
    if (Number.isFinite(cf)) p.set('codFeePerOrder', String(cf))
    if (Number.isFinite(rs)) p.set('returnShippingPerRto', String(rs))
    return p.toString()
  }, [from, to, codFee, returnShipping])

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
    setReturnShipping(initialReturnShipping)
  }, [initialCodFee, initialReturnShipping])

  const applyFilters = () => {
    router.push(`${pathname}?${buildParams()}`)
  }

  const gatewayPctLabel =
    data?.feesUsed &&
    typeof data.feesUsed.gatewayFeePercent === 'number' &&
    Number.isFinite(data.feesUsed.gatewayFeePercent)
      ? data.feesUsed.gatewayFeePercent.toLocaleString('en-IN', { maximumFractionDigits: 2 })
      : null

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-6 py-4 md:py-6">
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
            <UiTooltip>
              <TooltipTrigger asChild>
                <Label htmlFor="cod-fee" className="text-xs cursor-help">
                  COD fee/order (₹)
                </Label>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                Handling fee charged by your logistics partner per COD order. Typically ₹25–50 or 1–2%
                of order value. Check your Shiprocket rate card.
              </TooltipContent>
            </UiTooltip>
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
          {gatewayPctLabel != null && (
            <div className="space-y-1">
              <UiTooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs text-muted-foreground cursor-help leading-tight max-w-[11rem]">
                    Gateway fee: {gatewayPctLabel}% (from Costs)
                  </p>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                  Payment gateway fee % applied to prepaid orders. Pulled automatically from your Costs
                  page (Website Charges). Currently showing {gatewayPctLabel}%.
                </TooltipContent>
              </UiTooltip>
            </div>
          )}
          <div className="space-y-1">
            <UiTooltip>
              <TooltipTrigger asChild>
                <Label htmlFor="return-shipping" className="text-xs cursor-help">
                  Return shipping/RTO (₹)
                </Label>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                Shipping cost incurred when an order is returned to origin. Includes both the return leg
                charge from the courier. Typically ₹60–100 depending on courier and zone.
              </TooltipContent>
            </UiTooltip>
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
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Card className="cursor-help">
                      <CardHeader className="pb-1">
                        <CardTitle className="text-sm font-medium text-muted-foreground">COD orders</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <span className="text-2xl font-semibold tabular-nums">{data.codOrders.toLocaleString('en-IN')}</span>
                      </CardContent>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                    Total shipments where payment method is Cash on Delivery. Revenue is uncertain until
                    delivery is confirmed.
                  </TooltipContent>
                </UiTooltip>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Card className="cursor-help">
                      <CardHeader className="pb-1">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Prepaid orders</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <span className="text-2xl font-semibold tabular-nums">{data.prepaidOrders.toLocaleString('en-IN')}</span>
                      </CardContent>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                    Total shipments where payment was collected upfront (UPI, card, netbanking). Revenue is
                    certain at time of order.
                  </TooltipContent>
                </UiTooltip>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Card className="cursor-help">
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
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                    % of COD orders successfully delivered and payment collected. Formula: Delivered COD orders
                    ÷ Total COD orders × 100. Healthy = &gt;85%.
                  </TooltipContent>
                </UiTooltip>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Card className="cursor-help">
                      <CardHeader className="pb-1">
                        <CardTitle className="text-sm font-medium text-muted-foreground">COD RTO rate</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <span className="text-2xl font-semibold tabular-nums text-destructive">
                          {data.codRtoRatePercent != null ? `${data.codRtoRatePercent.toFixed(1)}%` : '—'}
                        </span>
                      </CardContent>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                    % of COD orders returned to origin (customer refused or unavailable). Formula: COD RTO orders
                    ÷ Total COD orders × 100. Target = &lt;15%.
                  </TooltipContent>
                </UiTooltip>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Card className="cursor-help">
                      <CardHeader className="pb-1">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Prepaid RTO rate</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <span className="text-2xl font-semibold tabular-nums text-destructive">
                          {data.prepaidRtoRatePercent != null ? `${data.prepaidRtoRatePercent.toFixed(1)}%` : '—'}
                        </span>
                      </CardContent>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                    % of prepaid orders returned to origin. Typically 3–5x lower than COD RTO because customers
                    have already paid. Target = &lt;7%.
                  </TooltipContent>
                </UiTooltip>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Card className="cursor-help">
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
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                    Revenue actually realized from COD orders after accounting for RTO losses, COD handling fees,
                    and return shipping costs. Formula: (Gross COD Revenue × Realization Rate) − COD fees −
                    Return shipping costs.
                  </TooltipContent>
                </UiTooltip>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Card className="cursor-help">
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
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                    Revenue realized from prepaid orders after payment gateway fees and prepaid RTO losses.
                    Formula: (Gross Prepaid Revenue × (1 − Prepaid RTO Rate)) − Gateway fees − Return shipping
                    costs.
                  </TooltipContent>
                </UiTooltip>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Card className="cursor-help">
                      <CardHeader className="pb-1">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Prepaid premium</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <span className={`text-2xl font-semibold tabular-nums ${data.prepaidPremium >= 0 ? 'text-green-600 dark:text-green-500' : 'text-destructive'}`}>
                          {fmtInr(data.prepaidPremium)}
                        </span>
                      </CardContent>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                    How much more revenue prepaid orders generate vs COD orders in total. Formula: Effective
                    Prepaid Revenue − Effective COD Revenue. A large positive number means you should actively
                    incentivize prepaid.
                  </TooltipContent>
                </UiTooltip>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Card className="cursor-help">
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
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                    The maximum COD RTO rate at which COD and Prepaid orders are equally profitable per order.
                    If your actual COD RTO rate exceeds this, COD is destroying value vs prepaid. Consider
                    restricting COD or offering prepaid discounts.
                  </TooltipContent>
                </UiTooltip>
              </div>

              {data.feesUsed && (
                <p className="text-xs text-muted-foreground">
                  Fees used: COD ₹{data.feesUsed.codFeePerOrder}/order
                  {typeof data.feesUsed.gatewayFeePercent === 'number' &&
                  Number.isFinite(data.feesUsed.gatewayFeePercent) ? (
                    <>
                      {', '}
                      Gateway fee:{' '}
                      {data.feesUsed.gatewayFeePercent.toLocaleString('en-IN', {
                        maximumFractionDigits: 2,
                      })}
                      % (from Costs)
                    </>
                  ) : null}
                  , Return shipping ₹{data.feesUsed.returnShippingPerRto}/RTO
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
                            <TableHead className="text-xs text-right">
                              <UiTooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help">Orders</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                                  Total shipments for this payment method in the selected period.
                                </TooltipContent>
                              </UiTooltip>
                            </TableHead>
                            <TableHead className="text-xs text-right">
                              <UiTooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help">Gross Revenue</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                                  Sum of order values for this payment method, before any deductions. Pulled from
                                  Shiprocket order totals.
                                </TooltipContent>
                              </UiTooltip>
                            </TableHead>
                            <TableHead className="text-xs text-right">
                              <UiTooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help">RTO Rate</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                                  % of orders that were returned to origin for this payment method.
                                </TooltipContent>
                              </UiTooltip>
                            </TableHead>
                            <TableHead className="text-xs text-right">
                              <UiTooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help">Effective Revenue</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                                  Net revenue after all RTO losses and fees. This is the money that actually stays
                                  in the business from this payment method.
                                </TooltipContent>
                              </UiTooltip>
                            </TableHead>
                            <TableHead className="text-xs text-right">
                              <UiTooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help">Fee (COD ₹ or gateway from Costs + return)</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                                  For COD: COD handling fee (₹/order) + return shipping cost (₹ × RTO orders).
                                  For Prepaid: gateway fee (% of gross revenue) + return shipping cost (₹ × RTO
                                  orders).
                                </TooltipContent>
                              </UiTooltip>
                            </TableHead>
                            <TableHead className="text-xs text-right">Net Revenue</TableHead>
                            <TableHead className="text-xs text-right">
                              <UiTooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help">Net / Order</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-sm whitespace-normal text-xs">
                                  Effective revenue divided by total orders. The true per-order revenue
                                  contribution for this payment method. Compare COD vs Prepaid to see the
                                  per-order value gap.
                                </TooltipContent>
                              </UiTooltip>
                            </TableHead>
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
    </TooltipProvider>
  )
}
