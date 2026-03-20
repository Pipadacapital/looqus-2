'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
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

type PaginationState = {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

type FilterState = {
  search: string
  statuses: string[]
  channelNames: string[]
  payment: 'COD' | 'PREPAID' | null
  mapping: 'MATCHED' | 'UNMATCHED' | null
  rtoOnly: boolean
}

interface ShiprocketContentProps {
  slug: string
  workspaceId: string
  connection: ConnectionInfo | null
  channels: ChannelInfo[]
  selectedChannelIds: string[]
  totalShipmentCount: number
  totalOrderCount: number
  filteredShipmentCount: number
  filteredCountInRange: number
  filteredOrderCountInRange: number
  deliveredCount: number
  rtoCount: number
  mappedCount: number
  shipments: ShipmentRow[]
  dateFrom: string
  dateTo: string
  showAllFallback?: boolean
  pagination: PaginationState
  filters: FilterState
  distinctStatusesFromPage: string[]
  pageSizeOptions: number[]
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

// ── Status badge (status string; RTO codes centralized in lib/workspace-metrics/constants) ──

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
  filteredCountInRange,
  filteredOrderCountInRange,
  deliveredCount,
  rtoCount,
  mappedCount,
  shipments,
  dateFrom,
  dateTo,
  showAllFallback = false,
  pagination,
  filters,
  distinctStatusesFromPage,
  pageSizeOptions,
}: ShiprocketContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [syncing, setSyncing] = useState(false)
  const [refreshingChannels, setRefreshingChannels] = useState(false)
  const [jsonModal, setJsonModal] = useState<unknown>(null)

  const [from, setFrom] = useState(dateFrom)
  const [to, setTo] = useState(dateTo)
  const [searchInput, setSearchInput] = useState(filters.search)

  useEffect(() => {
    setFrom(dateFrom)
    setTo(dateTo)
    setSearchInput(filters.search)
  }, [dateFrom, dateTo, filters.search])

  const buildParams = useCallback(
    (updates: {
      from?: string
      to?: string
      page?: number
      pageSize?: number
      q?: string
      status?: string
      channel?: string
      payment?: string | null
      mapping?: string | null
      rtoOnly?: boolean
    }) => {
      const p = new URLSearchParams()
      p.set('from', updates.from ?? dateFrom)
      p.set('to', updates.to ?? dateTo)
      p.set('page', String(updates.page ?? pagination.page))
      p.set('pageSize', String(updates.pageSize ?? pagination.pageSize))
      const q = updates.q !== undefined ? updates.q : filters.search
      if (q) p.set('q', q)
      else p.delete('q')
      const status =
        updates.status !== undefined ? updates.status : filters.statuses.join(',')
      if (status) p.set('status', status)
      else p.delete('status')
      const channel =
        updates.channel !== undefined
          ? updates.channel
          : filters.channelNames.join(',')
      if (channel) p.set('channel', channel)
      else p.delete('channel')
      const payment =
        updates.payment !== undefined ? updates.payment : filters.payment
      if (payment) p.set('payment', payment)
      else p.delete('payment')
      const mapping =
        updates.mapping !== undefined ? updates.mapping : filters.mapping
      if (mapping) p.set('mapping', mapping)
      else p.delete('mapping')
      const rtoOnly =
        updates.rtoOnly !== undefined ? updates.rtoOnly : filters.rtoOnly
      if (rtoOnly) p.set('rtoOnly', '1')
      else p.delete('rtoOnly')
      return p
    },
    [
      dateFrom,
      dateTo,
      pagination.page,
      pagination.pageSize,
      filters.search,
      filters.statuses,
      filters.channelNames,
      filters.payment,
      filters.mapping,
      filters.rtoOnly,
    ]
  )

  const navigate = useCallback(
    (params: URLSearchParams) => {
      router.push(`${pathname}?${params.toString()}`)
    },
    [pathname, router]
  )

  // Channels
  const [channels, setChannels] = useState<ChannelInfo[]>(initialChannels)
  const [selChannelIds, setSelChannelIds] = useState<Set<string>>(
    new Set(initialSelectedChannelIds)
  )

  const channelNameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const ch of channels) m.set(String(ch.id), ch.name)
    return m
  }, [channels])

  const distinctStatuses = useMemo(
    () =>
      [...new Set([...distinctStatusesFromPage, ...filters.statuses])].sort(),
    [distinctStatusesFromPage, filters.statuses]
  )

  const applyDateRange = () => {
    const params = buildParams({ from, to, page: 1 })
    navigate(params)
  }

  const applySearch = () => {
    const params = buildParams({ q: searchInput.trim() || undefined, page: 1 })
    navigate(params)
  }

  const toggleStatus = (st: string) => {
    const next = filters.statuses.includes(st)
      ? filters.statuses.filter((s) => s !== st)
      : [...filters.statuses, st]
    const params = buildParams({ status: next.join(','), page: 1 })
    navigate(params)
  }

  const toggleChannelFilter = (chName: string) => {
    const next = filters.channelNames.includes(chName)
      ? filters.channelNames.filter((c) => c !== chName)
      : [...filters.channelNames, chName]
    const params = buildParams({ channel: next.join(','), page: 1 })
    navigate(params)
  }

  const setPaymentFilter = (p: 'COD' | 'PREPAID' | null) => {
    const params = buildParams({ payment: p, page: 1 })
    navigate(params)
  }

  const setMappingFilter = (m: 'MATCHED' | 'UNMATCHED' | null) => {
    const params = buildParams({ mapping: m, page: 1 })
    navigate(params)
  }

  const setRtoOnly = (v: boolean) => {
    const params = buildParams({ rtoOnly: v, page: 1 })
    navigate(params)
  }

  const clearFilters = () => {
    setSearchInput('')
    const params = buildParams({
      q: undefined,
      status: undefined,
      channel: undefined,
      payment: null,
      mapping: null,
      rtoOnly: false,
      page: 1,
    })
    navigate(params)
  }

  const hasActiveFilters =
    filters.search !== '' ||
    filters.statuses.length > 0 ||
    filters.channelNames.length > 0 ||
    filters.payment !== null ||
    filters.mapping !== null ||
    filters.rtoOnly

  const goToPage = (page: number) => {
    const p = Math.max(1, Math.min(page, pagination.totalPages))
    const params = buildParams({ page: p })
    navigate(params)
  }

  const setPageSize = (size: number) => {
    const params = buildParams({ pageSize: size, page: 1 })
    navigate(params)
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
      const data = await res.json().catch(() => ({}))
      if (data.warning) toast.warning(data.warning)
      toast.success('Shiprocket sync complete — refreshing…')
      window.location.reload()
    } catch {
      toast.error('Network error during sync')
    } finally {
      setSyncing(false)
    }
  }

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
     

      {/* Summary tiles */}
      {connection && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile label="Total shipments" value={filteredShipmentCount} />
        
          <Tile label="In range" value={filteredCountInRange} />
          <Tile
            label="Showing"
            value={shipments.length}
            sub={
              pagination.totalCount > 0
                ? `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of ${pagination.totalCount.toLocaleString('en-IN')}`
                : hasActiveFilters
                  ? '(no matches)'
                  : undefined
            }
          />
          <Tile
            label="Delivered"
            value={deliveredCount}
            color="emerald"
          />
          <Tile
            label="RTO"
            value={rtoCount}
            color="red"
          />
        </div>
      )}

      {/* Filters */}
      {connection && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="flex items-center gap-1">
            <div className="relative">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="AWB / Shipment ID / Order…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                className="h-8 pl-8 w-56 text-xs"
              />
            </div>
            <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={applySearch}>
              Apply
            </Button>
          </div>

          {/* RTO toggle */}
          <Button
            size="sm"
            variant={filters.rtoOnly ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => setRtoOnly(!filters.rtoOnly)}
          >
            RTO*
          </Button>

          {/* Payment */}
          {(['COD', 'PREPAID'] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={filters.payment === p ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => setPaymentFilter(filters.payment === p ? null : p)}
            >
              {p}
            </Button>
          ))}

          {/* Mapping */}
          {(['MATCHED', 'UNMATCHED'] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={filters.mapping === m ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => setMappingFilter(filters.mapping === m ? null : m)}
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
                Status{filters.statuses.length > 0 ? ` (${filters.statuses.length})` : ''}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-60 p-3" align="start">
              <p className="text-xs font-medium mb-2">Filter by status</p>
              <div className="space-y-1.5 max-h-52 overflow-auto">
                {distinctStatuses.map((st) => (
                  <label key={st} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={filters.statuses.includes(st)}
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
                  Channel{filters.channelNames.length > 0 ? ` (${filters.channelNames.length})` : ''}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-3" align="start">
                <p className="text-xs font-medium mb-2">Filter by channel</p>
                <div className="space-y-1.5 max-h-52 overflow-auto">
                  {channels.map((ch) => (
                    <label key={ch.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox
                        checked={filters.channelNames.includes(ch.name)}
                        onCheckedChange={() => toggleChannelFilter(ch.name)}
                        className="h-3.5 w-3.5"
                      />
                      {ch.name}
                    </label>
                  ))}
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
            {mappedCount} / {pagination.totalCount.toLocaleString('en-IN')} mapped to Shopify
          </span>
        </div>
      )}

      {/* Shipments table */}
      {shipments.length > 0 && (
        <>
          {showAllFallback && (
            <div className="rounded-lg border bg-amber-500/10 border-amber-500/30 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
              No shipments fall within the selected date range. Showing first page of all shipments. Try an earlier start date and click <strong>Apply</strong> to filter by date.
            </div>
          )}
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
              {shipments.map((s) => {
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
                      {s.rawJson != null ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setJsonModal(s.rawJson)}
                          title="View raw JSON"
                        >
                          <IconEye className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between gap-4 flex-wrap py-3 px-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <span className="text-xs">
                ({(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of {pagination.totalCount.toLocaleString('en-IN')})
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Select
                value={String(pagination.pageSize)}
                onValueChange={(v: string) => setPageSize(Number(v))}
              >
                <SelectTrigger className="w-20 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} per page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                disabled={pagination.page <= 1}
                onClick={() => goToPage(1)}
                title="First page"
              >
                <IconChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                disabled={pagination.page <= 1}
                onClick={() => goToPage(pagination.page - 1)}
                title="Previous page"
              >
                <IconChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => goToPage(pagination.page + 1)}
                title="Next page"
              >
                <IconChevronRight className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => goToPage(pagination.totalPages)}
                title="Last page"
              >
                <IconChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        </>
      )}

      {connection && totalShipmentCount === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
          <p className="text-muted-foreground">
            No shipments yet. Sync from Shiprocket to load data, or try a wider date range and click <strong>Apply</strong>.
          </p>
          {connection.status === 'CONNECTED' && (
            <Button onClick={handleSync} disabled={syncing} size="sm">
              {syncing ? (
                <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
              )}
              Sync selected channels
            </Button>
          )}
        </div>
      )}

      {connection && totalShipmentCount > 0 && pagination.totalCount === 0 && (
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
