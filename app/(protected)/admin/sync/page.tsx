'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { IconRefresh, IconLoader2, IconArrowLeft, IconCheck, IconX } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ConnectionRow = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string | null
  selectedCustomerId: string | null
  customerCount: number
  lastSyncAt: string | null
  lastSyncError: string | null
}

type MetaConnectionRow = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string | null
  selectedAdAccountId: string | null
  adAccountCount: number
  lastSyncAt: string | null
  lastSyncError: string | null
}

type ShiprocketConnectionRow = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string | null
  email: string
  status: string
  lastSyncAt: string | null
  lastSyncError: string | null
}

type ShopifyConnectionRow = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string | null
  shopDomain: string
  lastSyncAt: string | null
}

type SyncResultRow = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  status: 'ok' | 'failed'
  error?: string
  /** Daily metric rows fetched & upserted (existing rows updated, no duplicates). */
  rowsSynced?: number
}

export default function AdminSyncPage() {
  const [connections, setConnections] = useState<ConnectionRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<{
    synced: number
    failed: number
    total: number
    days: number
    results: SyncResultRow[]
  } | null>(null)
  const [days, setDays] = useState(30)

  const [metaConnections, setMetaConnections] = useState<MetaConnectionRow[]>([])
  const [loadingMetaList, setLoadingMetaList] = useState(true)
  const [metaSyncing, setMetaSyncing] = useState(false)
  const [metaLastResult, setMetaLastResult] = useState<{
    synced: number
    failed: number
    total: number
    days: number
    results: SyncResultRow[]
  } | null>(null)
  const [metaDays, setMetaDays] = useState(30)

  const [shiprocketConnections, setShiprocketConnections] = useState<ShiprocketConnectionRow[]>([])
  const [loadingShiprocketList, setLoadingShiprocketList] = useState(true)
  const [shiprocketSyncing, setShiprocketSyncing] = useState(false)
  const [shiprocketLastResult, setShiprocketLastResult] = useState<{
    synced: number
    failed: number
    total: number
    results: SyncResultRow[]
  } | null>(null)

  const [shopifyConnections, setShopifyConnections] = useState<ShopifyConnectionRow[]>([])
  const [loadingShopifyList, setLoadingShopifyList] = useState(true)
  const [shopifySyncing, setShopifySyncing] = useState(false)
  const [shopifyLastResult, setShopifyLastResult] = useState<{
    synced: number
    failed: number
    total: number
    results: SyncResultRow[]
    analyticsOnly?: boolean
  } | null>(null)

  useEffect(() => {
    fetch('/api/admin/sync-all-google-ads')
      .then((res) => res.json())
      .then((data) => {
        if (data.connections) setConnections(data.connections)
      })
      .catch(() => toast.error('Failed to load connections'))
      .finally(() => setLoadingList(false))
  }, [lastResult])

  useEffect(() => {
    fetch('/api/admin/sync-all-meta-ads')
      .then((res) => res.json())
      .then((data) => {
        if (data.connections) setMetaConnections(data.connections)
      })
      .catch(() => toast.error('Failed to load Meta Ads connections'))
      .finally(() => setLoadingMetaList(false))
  }, [metaLastResult])

  useEffect(() => {
    fetch('/api/admin/sync-all-shiprocket')
      .then((res) => res.json())
      .then((data) => {
        if (data.connections) setShiprocketConnections(data.connections)
      })
      .catch(() => toast.error('Failed to load Shiprocket connections'))
      .finally(() => setLoadingShiprocketList(false))
  }, [shiprocketLastResult])

  useEffect(() => {
    fetch('/api/admin/sync-all-shopify')
      .then((res) => res.json())
      .then((data) => {
        if (data.connections) setShopifyConnections(data.connections)
      })
      .catch(() => toast.error('Failed to load Shopify connections'))
      .finally(() => setLoadingShopifyList(false))
  }, [shopifyLastResult])

  const handleSyncAll = async () => {
    setSyncing(true)
    setLastResult(null)
    try {
      const res = await fetch(
        `/api/admin/sync-all-google-ads?days=${days}`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Sync failed')
        return
      }
      setLastResult({
        synced: data.synced,
        failed: data.failed,
        total: data.total,
        days: data.days,
        results: data.results ?? [],
      })
      if (data.failed === 0 && data.synced > 0) {
        toast.success(`Synced ${data.synced} workspace(s)`)
      } else if (data.synced > 0) {
        toast.warning(`Synced ${data.synced}, failed ${data.failed}`)
      } else if (data.total === 0) {
        toast.info('No Google Ads connections to sync')
      } else {
        toast.error(`All ${data.failed} sync(s) failed`)
      }
    } finally {
      setSyncing(false)
    }
  }

  const handleSyncAllMeta = async () => {
    setMetaSyncing(true)
    setMetaLastResult(null)
    try {
      const res = await fetch(
        `/api/admin/sync-all-meta-ads?days=${metaDays}`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Meta Ads sync failed')
        return
      }
      setMetaLastResult({
        synced: data.synced,
        failed: data.failed,
        total: data.total,
        days: data.days,
        results: data.results ?? [],
      })
      if (data.failed === 0 && data.synced > 0) {
        toast.success(`Synced ${data.synced} Meta Ads workspace(s)`)
      } else if (data.synced > 0) {
        toast.warning(`Meta: synced ${data.synced}, failed ${data.failed}`)
      } else if (data.total === 0) {
        toast.info('No Meta Ads connections to sync')
      } else {
        toast.error(`All ${data.failed} Meta Ads sync(s) failed`)
      }
    } finally {
      setMetaSyncing(false)
    }
  }

  const handleSyncAllShiprocket = async () => {
    setShiprocketSyncing(true)
    setShiprocketLastResult(null)
    try {
      const res = await fetch('/api/admin/sync-all-shiprocket', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Shiprocket sync failed')
        return
      }
      setShiprocketLastResult({
        synced: data.synced,
        failed: data.failed,
        total: data.total,
        results: data.results ?? [],
      })
      if (data.failed === 0 && data.synced > 0) {
        toast.success(`Synced ${data.synced} Shiprocket workspace(s)`)
      } else if (data.synced > 0) {
        toast.warning(`Shiprocket: synced ${data.synced}, failed ${data.failed}`)
      } else if (data.total === 0) {
        toast.info('No Shiprocket connections to sync')
      } else {
        toast.error(`All ${data.failed} Shiprocket sync(s) failed`)
      }
    } finally {
      setShiprocketSyncing(false)
    }
  }

  const handleSyncAllShopify = async () => {
    setShopifySyncing(true)
    setShopifyLastResult(null)
    try {
      const res = await fetch('/api/admin/sync-all-shopify', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Shopify sync failed')
        return
      }
      setShopifyLastResult({
        synced: data.synced,
        failed: data.failed,
        total: data.total,
        results: data.results ?? [],
        analyticsOnly: data.analyticsOnly,
      })
      if (data.failed === 0 && data.synced > 0) {
        toast.success(data.analyticsOnly ? `Refreshed analytics for ${data.synced} workspace(s)` : `Synced ${data.synced} Shopify workspace(s)`)
      } else if (data.synced > 0) {
        toast.warning(`Shopify: synced ${data.synced}, failed ${data.failed}`)
      } else if (data.total === 0) {
        toast.info('No Shopify connections to sync')
      } else {
        toast.error(`All ${data.failed} Shopify sync(s) failed`)
      }
    } finally {
      setShopifySyncing(false)
    }
  }

  const handleRefreshShopifyAnalyticsOnly = async () => {
    setShopifySyncing(true)
    setShopifyLastResult(null)
    try {
      const res = await fetch('/api/admin/sync-all-shopify?analyticsOnly=true', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Analytics refresh failed')
        return
      }
      setShopifyLastResult({
        synced: data.synced,
        failed: data.failed,
        total: data.total,
        results: data.results ?? [],
        analyticsOnly: true,
      })
      if (data.failed === 0 && data.synced > 0) {
        toast.success(`Refreshed analytics for ${data.synced} workspace(s)`)
      } else if (data.synced > 0) {
        toast.warning(`Analytics: ${data.synced} ok, ${data.failed} failed`)
      } else if (data.total === 0) {
        toast.info('No Shopify connections')
      } else {
        toast.error(`All ${data.failed} refresh(es) failed`)
      }
    } finally {
      setShopifySyncing(false)
    }
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin">
              <IconArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sync all ads</h1>
            <p className="text-sm text-muted-foreground">
              Sync Google Ads, Meta Ads, Shiprocket, and Shopify (orders + analytics) for all workspaces. Each workspace uses its selected/linked account.
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium mb-1">Google Ads — connected workspaces</p>
          <p className="text-xs text-muted-foreground mb-2">
            Workspaces that have Google Ads connected (one row per workspace).
          </p>
          {loadingList ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Google Ads connections. Connect Google Ads in a workspace dashboard first.
            </p>
          ) : (
            <ul className="text-sm space-y-1.5">
              {connections.map((c) => {
                const lastSync = c.lastSyncAt ? new Date(c.lastSyncAt) : null
                const isFuture = lastSync && lastSync.getTime() > Date.now()
                return (
                  <li key={c.connectionId} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.workspaceName}</span>
                    <span className="text-muted-foreground text-xs" title={lastSync?.toISOString() ?? undefined}>
                      {lastSync
                        ? isFuture
                          ? `Last sync: ${lastSync.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} (check server date)`
                          : `Last sync: ${formatDistanceToNow(lastSync, { addSuffix: true })}`
                        : 'Never synced'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Sync last</span>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleSyncAll} disabled={syncing || connections.length === 0}>
            {syncing ? (
              <>
                <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing all…
              </>
            ) : (
              <>
                <IconRefresh className="mr-2 h-4 w-4" />
                Sync all Google Ads
              </>
            )}
          </Button>
        </div>

        {lastResult && (
          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
            <p className="text-sm font-medium">
              Google Ads result: {lastResult.synced} synced, {lastResult.failed} failed (last {lastResult.days} days)
              {lastResult.results.some((r) => typeof r.rowsSynced === 'number') && (
                <span className="text-muted-foreground font-normal">
                  {' '}
                  · {lastResult.results.reduce((s, r) => s + (r.rowsSynced ?? 0), 0)} metric rows upserted
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Upsert = existing rows updated, no duplicate rows. Numbers show how many daily metric rows were fetched and written.
            </p>
            <ul className="space-y-2">
              {lastResult.results.map((r) => (
                <li
                  key={r.connectionId}
                  className="flex items-center gap-2 text-sm"
                >
                  {r.status === 'ok' ? (
                    <IconCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : (
                    <IconX className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className="font-medium">{r.workspaceName}</span>
                  {typeof r.rowsSynced === 'number' && (
                    <span className="text-muted-foreground">
                      — {r.rowsSynced} rows
                    </span>
                  )}
                  {r.error && (
                    <span className="text-muted-foreground truncate" title={r.error}>
                      — {r.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <hr className="border-border" />

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium mb-1">Shopify — connected workspaces</p>
          <p className="text-xs text-muted-foreground mb-2">
            Sync orders, products, customers, and daily analytics (net sales, AOV, etc.) for all connected stores. Analytics are stored in our DB so we can blend with ad spend and power AI insights (Triple Whale–style).
          </p>
          {loadingShopifyList ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : shopifyConnections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Shopify connections. Connect a store from a workspace dashboard first.
            </p>
          ) : (
            <ul className="text-sm space-y-1.5">
              {shopifyConnections.map((c) => {
                const lastSync = c.lastSyncAt ? new Date(c.lastSyncAt) : null
                const isFuture = lastSync && lastSync.getTime() > Date.now()
                return (
                  <li key={c.connectionId} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.workspaceName}</span>
                    <span className="text-muted-foreground text-xs" title={lastSync?.toISOString() ?? undefined}>
                      {lastSync
                        ? isFuture
                          ? `Last sync: ${lastSync.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} (check server date)`
                          : `Last sync: ${formatDistanceToNow(lastSync, { addSuffix: true })}`
                        : 'Never synced'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleSyncAllShopify}
            disabled={shopifySyncing || shopifyConnections.length === 0}
          >
            {shopifySyncing ? (
              <>
                <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing all…
              </>
            ) : (
              <>
                <IconRefresh className="mr-2 h-4 w-4" />
                Sync all Shopify
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleRefreshShopifyAnalyticsOnly}
            disabled={shopifySyncing || shopifyConnections.length === 0}
          >
            {shopifySyncing ? (
              <>
                <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                Refreshing…
              </>
            ) : (
              <>
                <IconRefresh className="mr-2 h-4 w-4" />
                Refresh analytics only
              </>
            )}
          </Button>
        </div>

        {shopifyLastResult && (
          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
            <p className="text-sm font-medium">
              {shopifyLastResult.analyticsOnly ? 'Analytics refresh' : 'Shopify'} result: {shopifyLastResult.synced} synced, {shopifyLastResult.failed} failed
              {shopifyLastResult.results.some((r) => typeof r.rowsSynced === 'number') && (
                <span className="text-muted-foreground font-normal">
                  {' '}
                  · {shopifyLastResult.results.reduce((s, r) => s + (r.rowsSynced ?? 0), 0)} analytics days upserted
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {shopifyLastResult.analyticsOnly
                ? 'Recomputed daily analytics (net sales, orders, AOV) from existing orders in DB. No Shopify API calls.'
                : 'Full sync: orders, products, customers from Shopify, then daily analytics from order data.'}
            </p>
            <ul className="space-y-2">
              {shopifyLastResult.results.map((r) => (
                <li
                  key={r.connectionId}
                  className="flex items-center gap-2 text-sm"
                >
                  {r.status === 'ok' ? (
                    <IconCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : (
                    <IconX className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className="font-medium">{r.workspaceName}</span>
                  {typeof r.rowsSynced === 'number' && (
                    <span className="text-muted-foreground">
                      — {r.rowsSynced} days
                    </span>
                  )}
                  {r.error && (
                    <span className="text-muted-foreground truncate" title={r.error}>
                      — {r.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <hr className="border-border" />

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium mb-1">Meta Ads — connected workspaces</p>
          <p className="text-xs text-muted-foreground mb-2">
            Workspaces that have Meta (Facebook) Ads connected (one row per workspace).
          </p>
          {loadingMetaList ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : metaConnections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Meta Ads connections. Connect Meta Ads in a workspace dashboard first.
            </p>
          ) : (
            <ul className="text-sm space-y-1.5">
              {metaConnections.map((c) => {
                const lastSync = c.lastSyncAt ? new Date(c.lastSyncAt) : null
                const isFuture = lastSync && lastSync.getTime() > Date.now()
                return (
                  <li key={c.connectionId} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.workspaceName}</span>
                    <span className="text-muted-foreground text-xs" title={lastSync?.toISOString() ?? undefined}>
                      {lastSync
                        ? isFuture
                          ? `Last sync: ${lastSync.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} (check server date)`
                          : `Last sync: ${formatDistanceToNow(lastSync, { addSuffix: true })}`
                        : 'Never synced'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Sync last</span>
          <Select value={String(metaDays)} onValueChange={(v) => setMetaDays(Number(v))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleSyncAllMeta} disabled={metaSyncing || metaConnections.length === 0}>
            {metaSyncing ? (
              <>
                <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing all…
              </>
            ) : (
              <>
                <IconRefresh className="mr-2 h-4 w-4" />
                Sync all Meta Ads
              </>
            )}
          </Button>
        </div>

        {metaLastResult && (
          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
            <p className="text-sm font-medium">
              Meta Ads result: {metaLastResult.synced} synced, {metaLastResult.failed} failed (last {metaLastResult.days} days)
              {metaLastResult.results.some((r) => typeof r.rowsSynced === 'number') && (
                <span className="text-muted-foreground font-normal">
                  {' '}
                  · {metaLastResult.results.reduce((s, r) => s + (r.rowsSynced ?? 0), 0)} metric rows upserted
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Upsert = existing rows updated, no duplicate rows. Numbers show how many daily metric rows were fetched and written.
            </p>
            <ul className="space-y-2">
              {metaLastResult.results.map((r) => (
                <li
                  key={r.connectionId}
                  className="flex items-center gap-2 text-sm"
                >
                  {r.status === 'ok' ? (
                    <IconCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : (
                    <IconX className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className="font-medium">{r.workspaceName}</span>
                  {typeof r.rowsSynced === 'number' && (
                    <span className="text-muted-foreground">
                      — {r.rowsSynced} rows
                    </span>
                  )}
                  {r.error && (
                    <span className="text-muted-foreground truncate" title={r.error}>
                      — {r.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <hr className="border-border" />

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium mb-1">Shiprocket — workspaces</p>
          <p className="text-xs text-muted-foreground mb-2">
            Only connections with status CONNECTED are synced. If status is EXPIRED, reconnect from the workspace dashboard or set status to CONNECTED in the database.
          </p>
          {loadingShiprocketList ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : shiprocketConnections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Shiprocket connections. Connect Shiprocket in a workspace dashboard first.
            </p>
          ) : (
            <ul className="text-sm space-y-1.5">
              {shiprocketConnections.map((c) => {
                const lastSync = c.lastSyncAt ? new Date(c.lastSyncAt) : null
                const isFuture = lastSync && lastSync.getTime() > Date.now()
                const isConnected = c.status === 'CONNECTED'
                return (
                  <li key={c.connectionId} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.workspaceName}</span>
                    <span className="text-muted-foreground text-xs" title={lastSync?.toISOString() ?? undefined}>
                      {!isConnected && (
                        <span className={c.status === 'EXPIRED' ? 'text-amber-600' : ''}>
                          {c.status} ·{' '}
                        </span>
                      )}
                      {lastSync
                        ? isFuture
                          ? `Last sync: ${lastSync.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} (check server date)`
                          : `Last sync: ${formatDistanceToNow(lastSync, { addSuffix: true })}`
                        : 'Never synced'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleSyncAllShiprocket}
            disabled={shiprocketSyncing || shiprocketConnections.filter((c) => c.status === 'CONNECTED').length === 0}
          >
            {shiprocketSyncing ? (
              <>
                <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing all…
              </>
            ) : (
              <>
                <IconRefresh className="mr-2 h-4 w-4" />
                Sync all Shiprocket
              </>
            )}
          </Button>
        </div>

        {shiprocketLastResult && (
          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
            <p className="text-sm font-medium">
              Shiprocket result: {shiprocketLastResult.synced} synced, {shiprocketLastResult.failed} failed
            </p>
            <ul className="space-y-2">
              {shiprocketLastResult.results.map((r) => (
                <li
                  key={r.connectionId}
                  className="flex items-center gap-2 text-sm"
                >
                  {r.status === 'ok' ? (
                    <IconCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : (
                    <IconX className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className="font-medium">{r.workspaceName}</span>
                  {r.error && (
                    <span className="text-muted-foreground truncate" title={r.error}>
                      — {r.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          You can run the same sync via cron: POST /api/cron/sync-ads with header x-cron-secret: CRON_SECRET.
        </p>
      </div>
    </div>
  )
}
