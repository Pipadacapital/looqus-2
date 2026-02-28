'use client'

import { useState, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  IconRefresh,
  IconLoader2,
  IconEye,
  IconTruck,
  IconPackage,
  IconFilter,
  IconSearch,
  IconCheck,
  IconAlertTriangle,
} from '@tabler/icons-react'

// ── Types ──────────────────────────────────────────────────────────

type ConnectionInfo = {
  email: string
  status: string
  lastSyncAt: string | null
  lastSyncError: string | null
  createdAt: string
}

type ShipmentRow = {
  id: string
  shipmentId: string
  channelOrderId: string | null
  orderId: string | null
  awbCode: string | null
  courierName: string | null
  status: string | null
  statusCode: number | null
  trackingStatusCode: number | null
  trackingStatus: string | null
  paymentMethod: string | null
  shopifyOrderName: string | null
  isCod: boolean
  shippedAt: string | null
  shiprocketCreatedAt: string | null
  syncedAt: string
  rawJson: unknown
}

type ChannelInfo = { id: number; name: string }

interface ShiprocketContentProps {
  slug: string
  workspaceId: string
  connection: ConnectionInfo | null
  channels: ChannelInfo[]
  selectedChannelIds: string[]
  totalShipmentCount: number
  totalOrderCount: number
  filteredShipmentCount: number
  shipments: ShipmentRow[]
  dateFrom: string
  dateTo: string
}

// ── rawJson helpers ────────────────────────────────────────────────

function getString(raw: unknown, path: string): string | null {
  if (raw == null || typeof raw !== 'object') return null
  const keys = path.split('.')
  let cur: unknown = raw
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[k]
  }
  if (typeof cur === 'string' && cur.trim() !== '') return cur.trim()
  if (typeof cur === 'number') return String(cur)
  return null
}

function getNumber(raw: unknown, path: string): number | null {
  const v = getString(raw, path)
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function computeForwardShipping(raw: unknown): number | null {
  return (
    getNumber(raw, 'charges.applied_weight_amount') ??
    getNumber(raw, 'charges.charge_weight_amount') ??
    getNumber(raw, 'charges.freight_charges') ??
    getNumber(raw, 'freight_charges') ??
    null
  )
}

function computeRtoShipping(raw: unknown): number | null {
  return (
    getNumber(raw, 'charges.applied_weight_amount_rto') ??
    getNumber(raw, 'charges.charged_weight_amount_rto') ??
    null
  )
}

function getZone(raw: unknown): string | null {
  return getString(raw, 'charges.zone') ?? getString(raw, 'zone')
}

function getChargedWeight(raw: unknown): number | null {
  return (
    getNumber(raw, 'charges.charged_weight') ??
    getNumber(raw, 'charged_weight') ??
    null
  )
}

function getCodCharges(raw: unknown): number | null {
  return getNumber(raw, 'charges.cod_charges') ?? null
}

function getChannel(raw: unknown): string | null {
  return (
    getString(raw, 'channel_name') ??
    getString(raw, 'channel') ??
    getString(raw, 'base_channel_code') ??
    null
  )
}

// ── Status badge ───────────────────────────────────────────────────

const RTO_CODES = new Set([9, 10, 14, 20, 40, 41, 46])

function StatusText({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const upper = status.toUpperCase()
  if (upper.includes('RTO'))
    return <Badge variant="destructive" className="text-[10px]">{status}</Badge>
  if (upper.includes('DELIVER'))
    return <Badge className="bg-emerald-600 hover:bg-emerald-700 text-[10px]">{status}</Badge>
  if (upper.includes('CANCEL'))
    return <Badge variant="secondary" className="text-[10px]">{status}</Badge>
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>
}

// ── Currency helper ────────────────────────────────────────────────

function fmtInr(v: number | null): string {
  if (v == null) return '—'
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`
}

// ── Component ──────────────────────────────────────────────────────

export function ShiprocketContent({
  slug,
  workspaceId,
  connection,
  channels: initialChannels,
  selectedChannelIds: initialSelectedChannelIds,
  totalShipmentCount,
  totalOrderCount,
  filteredShipmentCount,
  shipments,
  dateFrom,
  dateTo,
}: ShiprocketContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [syncing, setSyncing] = useState(false)
  const [refreshingChannels, setRefreshingChannels] = useState(false)
  const [jsonModal, setJsonModal] = useState<unknown>(null)
  const [from, setFrom] = useState(dateFrom)
  const [to, setTo] = useState(dateTo)

  // Channels
  const [channels, setChannels] = useState<ChannelInfo[]>(initialChannels)
  const [selChannelIds, setSelChannelIds] = useState<Set<string>>(
    new Set(initialSelectedChannelIds)
  )
  const [channelFilter, setChannelFilter] = useState<Set<string>>(new Set())

  const channelNameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const ch of channels) m.set(String(ch.id), ch.name)
    return m
  }, [channels])

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set())
  const [paymentFilter, setPaymentFilter] = useState<string | null>(null)
  const [mappingFilter, setMappingFilter] = useState<string | null>(null)
  const [rtoOnly, setRtoOnly] = useState(false)

  // Derive distinct statuses from loaded data
  const distinctStatuses = useMemo(() => {
    const s = new Set<string>()
    for (const row of shipments) {
      if (row.status) s.add(row.status)
    }
    return [...s].sort()
  }, [shipments])

  // Client-side filter
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return shipments.filter((s) => {
      if (q) {
        const haystack = [
          s.shipmentId,
          s.orderId,
          s.channelOrderId,
          s.awbCode,
          s.shopifyOrderName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }

      if (channelFilter.size > 0) {
        const rowChannel = getChannel(s.rawJson)
        if (!rowChannel) return false
        const match = [...channelFilter].some(
          (chId) => channelNameMap.get(chId) === rowChannel
        )
        if (!match) return false
      }

      if (rtoOnly) {
        const upper = (s.status ?? '').toUpperCase()
        if (!upper.includes('RTO')) return false
      } else if (statusFilter.size > 0) {
        if (!s.status || !statusFilter.has(s.status)) return false
      }

      if (paymentFilter === 'COD' && !s.isCod) return false
      if (paymentFilter === 'PREPAID' && s.isCod) return false

      if (mappingFilter === 'MATCHED' && !s.shopifyOrderName) return false
      if (mappingFilter === 'UNMATCHED' && s.shopifyOrderName) return false

      return true
    })
  }, [shipments, search, channelFilter, channelNameMap, statusFilter, paymentFilter, mappingFilter, rtoOnly])

  // Summary counts
  const deliveredCount = filtered.filter(
    (s) => s.status?.toUpperCase().includes('DELIVER')
  ).length
  const rtoCount = filtered.filter(
    (s) => s.status?.toUpperCase().includes('RTO')
  ).length
  const mappedCount = filtered.filter((s) => s.shopifyOrderName).length

  const applyDateRange = () => {
    const params = new URLSearchParams()
    params.set('from', from)
    params.set('to', to)
    router.push(`${pathname}?${params.toString()}`)
  }

  const handleRefreshChannels = async () => {
    setRefreshingChannels(true)
    try {
      const res = await fetch('/api/integrations/shiprocket/refresh-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to refresh channels')
        return
      }
      const data = await res.json()
      setChannels(data.channels ?? [])
      setSelChannelIds(new Set(data.selectedChannelIds ?? []))
      toast.success(`${data.channels?.length ?? 0} channels discovered`)
    } catch {
      toast.error('Network error refreshing channels')
    } finally {
      setRefreshingChannels(false)
    }
  }

  const handleToggleChannel = async (chId: string) => {
    const next = new Set(selChannelIds)
    if (next.has(chId)) next.delete(chId)
    else next.add(chId)
    setSelChannelIds(next)

    try {
      const res = await fetch('/api/integrations/shiprocket/select-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, selectedChannelIds: [...next] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to update channels')
        setSelChannelIds(selChannelIds)
      }
    } catch {
      toast.error('Network error updating channels')
      setSelChannelIds(selChannelIds)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/integrations/shiprocket/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Sync failed')
        return
      }
      toast.success('Shiprocket sync complete — refreshing…')
      window.location.reload()
    } catch {
      toast.error('Network error during sync')
    } finally {
      setSyncing(false)
    }
  }

  const toggleStatus = (st: string) => {
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(st)) next.delete(st)
      else next.add(st)
      return next
    })
    setRtoOnly(false)
  }

  const toggleChannelFilter = (chId: string) => {
    setChannelFilter((prev) => {
      const next = new Set(prev)
      if (next.has(chId)) next.delete(chId)
      else next.add(chId)
      return next
    })
  }

  const clearFilters = () => {
    setSearch('')
    setStatusFilter(new Set())
    setPaymentFilter(null)
    setMappingFilter(null)
    setChannelFilter(new Set())
    setRtoOnly(false)
  }

  const hasActiveFilters =
    search !== '' ||
    statusFilter.size > 0 ||
    paymentFilter !== null ||
    mappingFilter !== null ||
    channelFilter.size > 0 ||
    rtoOnly

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shiprocket</h1>
          <p className="text-muted-foreground text-sm">
            Shipment data, filters and Shopify mapping
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-36 text-xs"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-36 text-xs"
            />
            <Button size="sm" variant="outline" onClick={applyDateRange} className="h-8 text-xs">
              Apply
            </Button>
          </div>
          {connection?.status === 'CONNECTED' && (
            <Button size="sm" onClick={handleSync} disabled={syncing} className="h-8">
              {syncing ? (
                <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
              )}
              Sync selected channels
            </Button>
          )}
        </div>
      </div>

      {/* Connection status */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Connection
        </h2>
        {connection ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Status</p>
              <Badge
                variant={connection.status === 'CONNECTED' ? 'default' : 'destructive'}
              >
                {connection.status}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Email</p>
              <p className="font-medium text-sm">{connection.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Last synced</p>
              <p className="font-medium text-sm">
                {connection.lastSyncAt
                  ? formatDistanceToNow(new Date(connection.lastSyncAt), { addSuffix: true })
                  : 'Never'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Connected</p>
              <p className="font-medium text-sm">
                {formatDistanceToNow(new Date(connection.createdAt), { addSuffix: true })}
              </p>
            </div>
            {connection.lastSyncError && (
              <div className="col-span-full">
                <p className="text-xs text-destructive font-mono bg-destructive/10 rounded px-2 py-1">
                  {connection.lastSyncError}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No Shiprocket connection. Connect from the Dashboard.
          </p>
        )}
      </div>

      {/* Channels */}
      {connection?.status === 'CONNECTED' && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Channels ({channels.length})
            </h2>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={refreshingChannels}
              onClick={handleRefreshChannels}
            >
              {refreshingChannels ? (
                <IconLoader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <IconRefresh className="mr-1 h-3 w-3" />
              )}
              Refresh channels
            </Button>
          </div>
          {channels.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {channels.map((ch) => {
                const chId = String(ch.id)
                const selected = selChannelIds.has(chId)
                return (
                  <label
                    key={chId}
                    className="flex items-center gap-1.5 text-xs cursor-pointer rounded-md border px-2.5 py-1.5 hover:bg-accent/50 transition-colors"
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => handleToggleChannel(chId)}
                      className="h-3.5 w-3.5"
                    />
                    <span className={selected ? 'font-medium' : 'text-muted-foreground'}>
                      {ch.name}
                    </span>
                    <span className="text-muted-foreground text-[10px]">#{chId}</span>
                  </label>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No channels discovered yet. Click <strong>Refresh channels</strong> or run a sync.
            </p>
          )}
          {channels.length > 0 && selChannelIds.size === 0 && (
            <p className="text-xs text-amber-600">
              No channels selected — sync will pull orders without channel filter.
            </p>
          )}
        </div>
      )}

      {/* Summary tiles */}
      {connection && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile label="Total shipments" value={totalShipmentCount} />
          <Tile label="Total orders" value={totalOrderCount} icon={<IconPackage className="h-3.5 w-3.5" />} />
          <Tile label="In range" value={filteredShipmentCount} />
          <Tile label="Showing" value={filtered.length} sub={hasActiveFilters ? '(filtered)' : undefined} />
          <Tile label="Delivered" value={deliveredCount} color="emerald" />
          <Tile label="RTO" value={rtoCount} color="red" />
        </div>
      )}

      {/* Filters */}
      {shipments.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="AWB / Shipment ID / Order…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 w-56 text-xs"
            />
          </div>

          {/* RTO toggle */}
          <Button
            size="sm"
            variant={rtoOnly ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => {
              setRtoOnly(!rtoOnly)
              if (!rtoOnly) setStatusFilter(new Set())
            }}
          >
            RTO*
          </Button>

          {/* Payment */}
          {(['COD', 'PREPAID'] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={paymentFilter === p ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => setPaymentFilter(paymentFilter === p ? null : p)}
            >
              {p}
            </Button>
          ))}

          {/* Mapping */}
          {(['MATCHED', 'UNMATCHED'] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={mappingFilter === m ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => setMappingFilter(mappingFilter === m ? null : m)}
            >
              {m === 'MATCHED' ? (
                <IconCheck className="mr-1 h-3 w-3" />
              ) : (
                <IconAlertTriangle className="mr-1 h-3 w-3" />
              )}
              {m}
            </Button>
          ))}

          {/* Status filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs">
                <IconFilter className="mr-1 h-3.5 w-3.5" />
                Status{statusFilter.size > 0 ? ` (${statusFilter.size})` : ''}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-60 p-3" align="start">
              <p className="text-xs font-medium mb-2">Filter by status</p>
              <div className="space-y-1.5 max-h-52 overflow-auto">
                {distinctStatuses.map((st) => (
                  <label key={st} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={statusFilter.has(st)}
                      onCheckedChange={() => toggleStatus(st)}
                      className="h-3.5 w-3.5"
                    />
                    {st}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Channel filter */}
          {channels.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 text-xs">
                  <IconFilter className="mr-1 h-3.5 w-3.5" />
                  Channel{channelFilter.size > 0 ? ` (${channelFilter.size})` : ''}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-3" align="start">
                <p className="text-xs font-medium mb-2">Filter by channel</p>
                <div className="space-y-1.5 max-h-52 overflow-auto">
                  {channels.map((ch) => {
                    const chId = String(ch.id)
                    return (
                      <label key={chId} className="flex items-center gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={channelFilter.has(chId)}
                          onCheckedChange={() => toggleChannelFilter(chId)}
                          className="h-3.5 w-3.5"
                        />
                        {ch.name}
                      </label>
                    )
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {hasActiveFilters && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearFilters}>
              Clear all
            </Button>
          )}

          <span className="text-xs text-muted-foreground ml-auto">
            {mappedCount} / {filtered.length} mapped to Shopify
          </span>
        </div>
      )}

      {/* Shipments table */}
      {filtered.length > 0 && (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] w-20">Shipment</TableHead>
                <TableHead className="text-[10px]">SR Order</TableHead>
                <TableHead className="text-[10px]">Channel</TableHead>
                <TableHead className="text-[10px]">Shopify Ref</TableHead>
                <TableHead className="text-[10px]">AWB</TableHead>
                <TableHead className="text-[10px]">Status</TableHead>
                <TableHead className="text-[10px]">Payment</TableHead>
                <TableHead className="text-[10px]">Created</TableHead>
                <TableHead className="text-[10px]">Zone</TableHead>
                <TableHead className="text-[10px] text-right">Wt (kg)</TableHead>
                <TableHead className="text-[10px] text-right">Fwd ₹</TableHead>
                <TableHead className="text-[10px] text-right">COD ₹</TableHead>
                <TableHead className="text-[10px] text-right">RTO ₹</TableHead>
                <TableHead className="text-[10px] w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => {
                const zone = getZone(s.rawJson)
                const weight = getChargedWeight(s.rawJson)
                const fwd = computeForwardShipping(s.rawJson)
                const cod = getCodCharges(s.rawJson)
                const rto = computeRtoShipping(s.rawJson)
                const rawChannel = getChannel(s.rawJson)
                const channelLabel =
                  rawChannel ??
                  (getString(s.rawJson, 'channel_id')
                    ? channelNameMap.get(getString(s.rawJson, 'channel_id')!) ?? getString(s.rawJson, 'channel_id')
                    : null)
                const shopifyRef = s.shopifyOrderName ?? s.channelOrderId
                const createdDate = s.shiprocketCreatedAt
                  ? new Date(s.shiprocketCreatedAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: '2-digit',
                    })
                  : '—'
                const payment = s.paymentMethod ?? (s.isCod ? 'COD' : 'Prepaid')

                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-[11px]">
                      {s.shipmentId}
                    </TableCell>
                    <TableCell className="text-[11px]">
                      {s.orderId || '—'}
                    </TableCell>
                    <TableCell className="text-[11px]">
                      {channelLabel || '—'}
                    </TableCell>
                    <TableCell className="text-[11px]">
                      {s.shopifyOrderName ? (
                        <span className="flex items-center gap-1">
                          <IconCheck className="h-3 w-3 text-emerald-500" />
                          {s.shopifyOrderName}
                        </span>
                      ) : shopifyRef ? (
                        <span className="text-muted-foreground">{shopifyRef}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px]">
                      {s.awbCode || '—'}
                    </TableCell>
                    <TableCell>
                      <StatusText status={s.status} />
                    </TableCell>
                    <TableCell className="text-[11px]">
                      <Badge
                        variant={s.isCod ? 'secondary' : 'outline'}
                        className="text-[10px]"
                      >
                        {payment}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap">
                      {createdDate}
                    </TableCell>
                    <TableCell className="text-[11px]">
                      {zone || '—'}
                    </TableCell>
                    <TableCell className="text-[11px] text-right">
                      {weight != null ? weight.toFixed(2) : '—'}
                    </TableCell>
                    <TableCell className="text-[11px] text-right">
                      {fmtInr(fwd)}
                    </TableCell>
                    <TableCell className="text-[11px] text-right">
                      {fmtInr(cod)}
                    </TableCell>
                    <TableCell className="text-[11px] text-right">
                      {fmtInr(rto)}
                    </TableCell>
                    <TableCell>
                      {s.rawJson && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setJsonModal(s.rawJson)}
                          title="View raw JSON"
                        >
                          <IconEye className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {connection && shipments.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No shipments in this date range. Try a wider range or click{' '}
            <strong>Fetch live now</strong>.
          </p>
        </div>
      )}

      {connection && shipments.length > 0 && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No shipments match the current filters.{' '}
            <button className="underline" onClick={clearFilters}>
              Clear all filters
            </button>
          </p>
        </div>
      )}

      {/* Raw JSON modal */}
      <Dialog open={jsonModal !== null} onOpenChange={() => setJsonModal(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Raw Shiprocket JSON</DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-muted rounded p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap">
            {jsonModal != null ? JSON.stringify(jsonModal, null, 2) : ''}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Tile helper ────────────────────────────────────────────────────

function Tile({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string
  value: number
  sub?: string
  color?: 'emerald' | 'red'
  icon?: React.ReactNode
}) {
  const textColor =
    color === 'emerald'
      ? 'text-emerald-600'
      : color === 'red'
        ? 'text-red-600'
        : ''
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5">
        {icon ?? <IconTruck className="h-3.5 w-3.5 text-muted-foreground" />}
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {label}
        </p>
      </div>
      <p className={`text-xl font-bold mt-0.5 ${textColor}`}>
        {value.toLocaleString('en-IN')}
        {sub && (
          <span className="text-xs font-normal text-muted-foreground ml-1">
            {sub}
          </span>
        )}
      </p>
    </div>
  )
}
