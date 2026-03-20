'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IconLoader2, IconRefresh } from '@tabler/icons-react'
import { toast } from 'sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface AdsBackfillClientProps {
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  isOwner: boolean
}

export function AdsBackfillClient({
  workspaceId,
  workspaceName,
  workspaceSlug,
  isOwner,
}: AdsBackfillClientProps) {
  const [loading, setLoading] = useState(false)
  const [returnsLoading, setReturnsLoading] = useState(false)
  const [refundLinesLoading, setRefundLinesLoading] = useState(false)
  const [rebuildLoading, setRebuildLoading] = useState(false)
  const [rebuildFrom, setRebuildFrom] = useState('2026-02-01')
  const [rebuildTo, setRebuildTo] = useState('2026-02-28')
  const [courierBackfillLoading, setCourierBackfillLoading] = useState(false)
  const [courierBackfillResult, setCourierBackfillResult] = useState<{
    totalCandidates: number
    updatedFromRaw: number
    updatedFromTracking: number
    stillNull: number
    completedFully: boolean
  } | null>(null)
  const [pincodeBackfillLoading, setPincodeBackfillLoading] = useState(false)
  const [pincodeBackfillResult, setPincodeBackfillResult] = useState<{
    candidates: number
    shipmentRawHits: number
    linkedOrderHits: number
    orderApiHits: number
    orderApiErrors: string[]
    stillMissing: number
  } | null>(null)

  async function handleBackfill() {
    if (!isOwner) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/integrations/ads/backfill?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Backfill failed')
        return
      }
      const metaRows = data.meta?.rowsSynced ?? 0
      const googleRows = data.google?.rowsSynced ?? 0
      toast.success(
        `Backfill complete: Meta ${metaRows} rows, Google ${googleRows} rows`
      )
    } catch {
      toast.error('Backfill failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSyncRefundLineItems() {
    if (!isOwner) return
    setRefundLinesLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/shopify/sync-refunds`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Refund line sync failed')
        return
      }
      toast.success(
        data.refundLinesUpserted != null
          ? `Refund lines synced: ${data.refundLinesUpserted} rows (${data.from}–${data.to})`
          : 'Refund line sync complete'
      )
    } catch {
      toast.error('Refund line sync failed')
    } finally {
      setRefundLinesLoading(false)
    }
  }

  async function handleBackfillShopifyReturns() {
    if (!isOwner) return
    setReturnsLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/shopify/backfill-returns`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Backfill failed')
        return
      }
      toast.success(
        data.dailyRowsUpdated != null
          ? `Backfill complete: updated ${data.dailyRowsUpdated} daily rows (${data.from}–${data.to})`
          : 'Backfill complete'
      )
    } catch {
      toast.error('Backfill failed')
    } finally {
      setReturnsLoading(false)
    }
  }

  async function handleBackfillShiprocketCouriers() {
    if (!isOwner) return
    setCourierBackfillLoading(true)
    setCourierBackfillResult(null)
    let acc = { totalCandidates: 0, updatedFromRaw: 0, updatedFromTracking: 0, stillNull: 0 }
    try {
      for (;;) {
        const res = await fetch(`/api/workspaces/${workspaceSlug}/shiprocket/backfill-courier`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackingBatchPerRequest: 150 }),
          credentials: 'include',
        })
        const data = await res.json()
        if (!res.ok) {
          toast.error(data.error || 'Backfill failed')
          break
        }
        if (acc.totalCandidates === 0) acc.totalCandidates = data.totalCandidates ?? 0
        acc = {
          ...acc,
          updatedFromRaw: acc.updatedFromRaw + (data.updatedFromRaw ?? 0),
          updatedFromTracking: acc.updatedFromTracking + (data.updatedFromTracking ?? 0),
          stillNull: data.stillNull ?? 0,
        }
        const completedFully = data.completedFully === true
        setCourierBackfillResult({
          ...acc,
          completedFully,
        })
        const progress = (data.updatedFromRaw ?? 0) + (data.updatedFromTracking ?? 0)
        if (completedFully || progress === 0) break
      }
      const repaired = acc.updatedFromRaw + acc.updatedFromTracking
      toast.success(
        repaired > 0
          ? `Courier backfill complete: ${repaired} repaired (${acc.updatedFromRaw} from data, ${acc.updatedFromTracking} from tracking). ${acc.stillNull} still unresolved.`
          : acc.stillNull === 0
            ? 'No shipments needed courier repair.'
            : `Courier backfill complete. ${acc.stillNull} still unresolved.`
      )
    } catch {
      toast.error('Backfill failed')
    } finally {
      setCourierBackfillLoading(false)
    }
  }

  async function handleBackfillShiprocketPincodes() {
    if (!isOwner) return
    setPincodeBackfillLoading(true)
    setPincodeBackfillResult(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/shiprocket/backfill-pincode`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Backfill failed')
        return
      }
      const result = {
        candidates: data.candidates ?? 0,
        shipmentRawHits: data.shipmentRawHits ?? 0,
        linkedOrderHits: data.linkedOrderHits ?? 0,
        orderApiHits: data.orderApiHits ?? 0,
        orderApiErrors: Array.isArray(data.orderApiErrors) ? data.orderApiErrors : [],
        stillMissing: data.stillMissing ?? 0,
      }
      setPincodeBackfillResult(result)
      const totalUpdated = result.shipmentRawHits + result.linkedOrderHits + result.orderApiHits
      if (result.orderApiErrors.length > 0) toast.error(`${result.orderApiErrors.length} API error(s) during backfill`)
      toast.success(
        totalUpdated > 0
          ? `Pincode backfill: ${totalUpdated} updated (shipment: ${result.shipmentRawHits}, order: ${result.linkedOrderHits}, API: ${result.orderApiHits}). ${result.stillMissing} still missing.`
          : result.stillMissing === 0
            ? 'No shipments needed pincode repair.'
            : `Pincode backfill complete. ${result.stillMissing} still missing. Run again to fetch more via API.`
      )
    } catch {
      toast.error('Backfill failed')
    } finally {
      setPincodeBackfillLoading(false)
    }
  }

  async function handleRebuildReturnsForRange() {
    if (!isOwner) return
    if (!rebuildFrom || !rebuildTo || rebuildFrom > rebuildTo) {
      toast.error('Enter a valid from/to date range')
      return
    }
    setRebuildLoading(true)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/shopify/rebuild-returns?from=${encodeURIComponent(rebuildFrom)}&to=${encodeURIComponent(rebuildTo)}`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Rebuild failed')
        return
      }
      toast.success(
        `Rebuild complete: wiped ${data.rowsWiped ?? 0} rows, updated ${data.dailyRowsUpdated ?? 0} from ShopifyQL`
      )
    } catch {
      toast.error('Rebuild failed')
    } finally {
      setRebuildLoading(false)
    }
  }

  if (!isOwner) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button disabled variant="outline">
                Backfill Meta+Google (2 years)
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Owner only</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Ads (Meta + Google)</h2>
        <p className="text-sm text-muted-foreground">
          Fetches up to 2 years of daily Meta and Google Ads metrics (spend, impressions,
          clicks, etc.) into this workspace. Use after connecting Meta and Google Ads, or to
          refresh historical data.
        </p>
        <Button
          onClick={handleBackfill}
          disabled={loading}
          className="gap-2"
        >
          {loading ? (
            <>
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Backfilling…
            </>
          ) : (
            <>
              <IconRefresh className="h-4 w-4" />
              Backfill Meta+Google (2 years)
            </>
          )}
        </Button>
      </section>

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-medium">Shopify Returns (P&L)</h2>
        <p className="text-sm text-muted-foreground">
          Sync total_returns and returns from ShopifyQL into shopify_analytics_daily. P&L uses
          refunds = total_returns, productRefunds = returns, shippingRefunds = total_returns − returns.
        </p>
        <Button
          onClick={handleBackfillShopifyReturns}
          disabled={returnsLoading}
          variant="outline"
          className="gap-2"
        >
          {returnsLoading ? (
            <>
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Backfilling…
            </>
          ) : (
            <>
              <IconRefresh className="h-4 w-4" />
              Backfill Shopify Returns (full range)
            </>
          )}
        </Button>

        <div className="rounded-md border p-4 space-y-3 mt-4">
          <p className="text-sm font-medium">Rebuild Shopify returns for range</p>
          <p className="text-xs text-muted-foreground">
            Wipes total_returns and returns for the range, then re-fetches from ShopifyQL and writes
            fresh values. Use to fix wrong dates/values (e.g. Feb 2026).
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="rebuild-from" className="text-xs">From</Label>
              <Input
                id="rebuild-from"
                type="date"
                value={rebuildFrom}
                onChange={(e) => setRebuildFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rebuild-to" className="text-xs">To</Label>
              <Input
                id="rebuild-to"
                type="date"
                value={rebuildTo}
                onChange={(e) => setRebuildTo(e.target.value)}
                className="w-40"
              />
            </div>
            <Button
              onClick={handleRebuildReturnsForRange}
              disabled={rebuildLoading}
              variant="secondary"
              className="gap-2"
            >
              {rebuildLoading ? (
                <>
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                  Rebuilding…
                </>
              ) : (
                'Rebuild returns for range'
              )}
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-medium">Shiprocket couriers (Logistics)</h2>
        <p className="text-sm text-muted-foreground">
          One-click repair of historical Shiprocket shipments missing courier names. Processes
          all eligible rows: first from stored data (rawJson), then tracking API for remaining.
          Runs until complete or no more progress. Safe to rerun. Improves Logistics → By Courier.
        </p>
        <Button
          onClick={handleBackfillShiprocketCouriers}
          disabled={courierBackfillLoading}
          variant="outline"
          className="gap-2"
        >
          {courierBackfillLoading ? (
            <>
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Backfilling…
            </>
          ) : (
            <>
              <IconRefresh className="h-4 w-4" />
              Backfill Shiprocket couriers
            </>
          )}
        </Button>
        {courierBackfillResult != null && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium mb-1">Last run</p>
            <p className="text-muted-foreground">
              {courierBackfillResult.totalCandidates} candidate rows → {courierBackfillResult.updatedFromRaw} from stored
              data, {courierBackfillResult.updatedFromTracking} from tracking. {courierBackfillResult.stillNull} still
              unresolved. {courierBackfillResult.completedFully ? 'Run completed fully.' : 'Partial run (safe to run again).'}
            </p>
          </div>
        )}
      </section>

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-medium">Shiprocket pincodes (Pincode Intelligence)</h2>
        <p className="text-sm text-muted-foreground">
          Enrichment backfill: fills delivery pincode, city, and state for historical shipments
          from (1) stored shipment/order data, then (2) Shiprocket order API when needed. Run
          again to process more via API (rate-limited per run). Safe to rerun. Improves Pincode Intelligence.
        </p>
        <Button
          onClick={handleBackfillShiprocketPincodes}
          disabled={pincodeBackfillLoading}
          variant="outline"
          className="gap-2"
        >
          {pincodeBackfillLoading ? (
            <>
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Backfilling…
            </>
          ) : (
            <>
              <IconRefresh className="h-4 w-4" />
              Backfill Shiprocket pincodes
            </>
          )}
        </Button>
        {pincodeBackfillResult != null && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <p className="font-medium">Last run</p>
            <p className="text-muted-foreground">
              {pincodeBackfillResult.candidates} candidates → Phase 1: {pincodeBackfillResult.shipmentRawHits}, Phase 2: {pincodeBackfillResult.linkedOrderHits}, Phase 3: {pincodeBackfillResult.orderApiHits}. {pincodeBackfillResult.stillMissing} still missing.
            </p>
            {pincodeBackfillResult.orderApiErrors.length > 0 && (
              <p className="text-destructive text-xs">
                {pincodeBackfillResult.orderApiErrors.length} API error(s): {pincodeBackfillResult.orderApiErrors.slice(0, 2).join('; ')}
                {pincodeBackfillResult.orderApiErrors.length > 2 ? '…' : ''}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-medium">Shopify Refund Line Items (Products page)</h2>
        <p className="text-sm text-muted-foreground">
          Populates shopify_refund_line_items from Shopify (orders → refunds → refundLineItems).
          Required for the Products page to show exact Refunds and Refunded quantity per product/variant.
          Default range: last 4 years. Run after orders are synced.
        </p>
        <Button
          onClick={handleSyncRefundLineItems}
          disabled={refundLinesLoading || !isOwner}
          variant="outline"
          className="gap-2"
        >
          {refundLinesLoading ? (
            <>
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Syncing…
            </>
          ) : (
            <>
              <IconRefresh className="h-4 w-4" />
              Sync refund line items (last 4 years)
            </>
          )}
        </Button>
      </section>
    </div>
  )
}
