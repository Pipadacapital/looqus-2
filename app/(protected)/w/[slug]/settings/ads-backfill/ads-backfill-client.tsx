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
  const [rebuildLoading, setRebuildLoading] = useState(false)
  const [rebuildFrom, setRebuildFrom] = useState('2026-02-01')
  const [rebuildTo, setRebuildTo] = useState('2026-02-28')

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

  async function handleBackfillShopifyReturns() {
    if (!isOwner) return
    setReturnsLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/shopify/backfill-returns`, {
        method: 'POST',
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
    </div>
  )
}
