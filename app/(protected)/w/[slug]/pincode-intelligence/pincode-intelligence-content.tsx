'use client'

import { useState, useEffect, useCallback } from 'react'
import { IconRoute, IconLoader2, IconSearch } from '@tabler/icons-react'
import { DateRangeFilter } from '@/components/analytics'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { formatCurrency } from '@/components/analytics/types'

type Row = {
  pincode: string
  city: string
  state: string
  orders: number
  revenue: number
  aov: number | null
  shipmentCount: number
  rtoCount: number
  rtoPercent: number | null
  codCount: number
  codPercent: number | null
  deliveredCount: number
  deliveredPercent: number | null
  topCourier: string
  tier: 1 | 2 | 3 | null
  uniqueCustomers: number
  repeatRate: number | null
  profitabilityScore: number
  matchedShipments: null
}

type ApiResponse = {
  from: string
  to: string
  rows: Row[]
  totalShipments: number
  shipmentsWithPincode: number
  matchedShipments: number
  caveat?: string
}

interface PincodeIntelligenceContentProps {
  workspaceSlug: string
  workspaceName: string
  initialFrom: string
  initialTo: string
}

export function PincodeIntelligenceContent({
  workspaceSlug: slug,
  workspaceName,
  initialFrom,
  initialTo,
}: PincodeIntelligenceContentProps) {
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const insightProps = usePageInsights(slug, 'pincode-intelligence', from, to)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [minOrders, setMinOrders] = useState('')
  const [highRtoOnly, setHighRtoOnly] = useState(false)
  const [highCodOnly, setHighCodOnly] = useState(false)
  const [sort, setSort] = useState('orders')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const buildParams = useCallback(() => {
    const p = new URLSearchParams()
    p.set('from', from)
    p.set('to', to)
    if (search.trim()) p.set('search', search.trim())
    if (stateFilter.trim()) p.set('state', stateFilter.trim())
    const min = parseInt(minOrders, 10)
    if (Number.isFinite(min) && min > 0) p.set('minOrders', String(min))
    if (highRtoOnly) p.set('highRto', 'true')
    if (highCodOnly) p.set('highCod', 'true')
    p.set('sort', sort)
    p.set('order', order)
    return p.toString()
  }, [from, to, search, stateFilter, minOrders, highRtoOnly, highCodOnly, sort, order])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${slug}/pincode-intelligence?${buildParams()}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      const json: ApiResponse = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pincode intelligence')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [slug, buildParams])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSort = (key: string) => {
    if (sort === key) {
      setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))
    } else {
      setSort(key)
      setOrder('desc')
    }
  }

  const currency = 'INR'

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconRoute className="h-7 w-7" />
            Pincode Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">
            Delivery pincode view: orders, revenue, RTO %, COD %, and delivered % by area. Pincode/city/state from
            Shiprocket; orders and revenue from matched Shopify orders. Same RTO/delivered definitions as Logistics.
          </p>
        </div>
        <InsightSheet
          page="pincode-intelligence"
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
          fromId="pincode-from"
          toId="pincode-to"
        />
        <div className="flex items-center gap-2">
          <Label htmlFor="pincode-search" className="text-xs whitespace-nowrap">Search</Label>
          <Input
            id="pincode-search"
            type="text"
            placeholder="Pincode, city, state…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="pincode-state" className="text-xs whitespace-nowrap">State</Label>
          <Input
            id="pincode-state"
            type="text"
            placeholder="Filter by state"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="w-32"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="pincode-min-orders" className="text-xs whitespace-nowrap">Min orders</Label>
          <Input
            id="pincode-min-orders"
            type="number"
            min={0}
            placeholder="0"
            value={minOrders}
            onChange={(e) => setMinOrders(e.target.value)}
            className="w-24"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={highRtoOnly}
            onChange={(e) => setHighRtoOnly(e.target.checked)}
          />
          High RTO (≥20%)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={highCodOnly}
            onChange={(e) => setHighCodOnly(e.target.checked)}
          />
          High COD (≥50%)
        </label>
        <Button size="sm" onClick={fetchData}>
          Apply
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <IconLoader2 className="h-5 w-5 animate-spin" />
          Loading pincode intelligence…
        </div>
      )}

      {!loading && data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              By Pincode ({data.rows.length} rows)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No pincodes match the filters. Try a wider date range or clear filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><button type="button" className="font-medium" onClick={() => handleSort('pincode')}>Pincode</button></TableHead>
                      <TableHead><button type="button" className="font-medium" onClick={() => handleSort('city')}>City</button></TableHead>
                      <TableHead><button type="button" className="font-medium" onClick={() => handleSort('state')}>State</button></TableHead>
                      <TableHead className="text-right"><button type="button" className="font-medium" onClick={() => handleSort('orders')}>Orders</button></TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">AOV</TableHead>
                      <TableHead className="text-right"><button type="button" className="font-medium" onClick={() => handleSort('rtoPercent')}>RTO %</button></TableHead>
                      <TableHead className="text-right"><button type="button" className="font-medium" onClick={() => handleSort('codPercent')}>COD %</button></TableHead>
                      <TableHead className="text-right">Delivered %</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead className="text-right">Unique Customers</TableHead>
                      <TableHead className="text-right">Repeat %</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead>Top Courier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row) => (
                      <TableRow key={`${row.pincode}-${row.city}-${row.state}`}>
                        <TableCell className="font-medium">{row.pincode}</TableCell>
                        <TableCell>{row.city}</TableCell>
                        <TableCell>{row.state}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.orders}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(row.revenue, currency)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.aov != null ? formatCurrency(row.aov, currency) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.rtoPercent != null ? `${row.rtoPercent}%` : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.codPercent != null ? `${row.codPercent}%` : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.deliveredPercent != null ? `${row.deliveredPercent}%` : '—'}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs">
                            {row.tier === 1 ? 'T1' : row.tier === 2 ? 'T2' : row.tier === 3 ? 'T3' : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.uniqueCustomers}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.repeatRate != null ? `${row.repeatRate}%` : '—'}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            row.profitabilityScore >= 70
                              ? 'text-green-600'
                              : row.profitabilityScore >= 40
                                ? 'text-yellow-600'
                                : 'text-red-600'
                          }`}
                        >
                          {row.profitabilityScore}
                        </TableCell>
                        <TableCell>{row.topCourier}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
