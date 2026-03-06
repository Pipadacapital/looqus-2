'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { format, subDays } from 'date-fns'
import {
  IconClock,
  IconLoader2,
  IconPlugConnected,
  IconDownload,
  IconShare3,
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TimingsDateRangePopover } from '@/components/timings/date-range-popover'
import { toast } from 'sonner'
import type {
  TimingsGroupBy,
  TimingsGroupRow,
  TimingsMetric,
  TimingsSummary,
} from '@/lib/timings/types'

type ShopifyConnectionInfo = {
  id: string
  shopDomain: string
  status: string
  lastSyncAt: string | null
}

interface TimingsContentProps {
  workspaceSlug: string
  workspaceName: string
  shopifyConnection: ShopifyConnectionInfo | null
}

const DEFAULT_FROM = format(subDays(new Date(), 729), 'yyyy-MM-dd')
const DEFAULT_TO = format(new Date(), 'yyyy-MM-dd')
const GROUP_BY_OPTIONS: Array<{ value: TimingsGroupBy; label: string }> = [
  { value: 'product', label: 'Product' },
  { value: 'variant', label: 'Variant' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'productType', label: 'Product Type' },
]

function isTimingsGroupBy(value: string | null): value is TimingsGroupBy {
  return GROUP_BY_OPTIONS.some((option) => option.value === value)
}

function getGroupByLabel(groupBy: TimingsGroupBy): string {
  return GROUP_BY_OPTIONS.find((option) => option.value === groupBy)?.label ?? 'Product'
}

function getGroupByPluralLabel(groupBy: TimingsGroupBy): string {
  switch (groupBy) {
    case 'productType':
      return 'product types'
    default:
      return `${getGroupByLabel(groupBy).toLowerCase()}s`
  }
}

function formatDays(value: number | null, approximate = false): string {
  if (value == null) return '—'
  const prefix = approximate ? '~' : ''
  return `${prefix}${value.toFixed(1)} days`
}

export function TimingsContent({
  workspaceSlug,
  workspaceName,
  shopifyConnection,
}: TimingsContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const fromParam = searchParams.get('from') ?? DEFAULT_FROM
  const toParam = searchParams.get('to') ?? DEFAULT_TO
  const metricParam = (searchParams.get('metric') as TimingsMetric) ?? 'median'
  const groupByParam = isTimingsGroupBy(searchParams.get('groupBy'))
    ? (searchParams.get('groupBy') as TimingsGroupBy)
    : 'product'
  const groupIdParam =
    searchParams.get('groupId') ?? searchParams.get('productId') ?? ''

  const [from, setFrom] = useState(fromParam)
  const [to, setTo] = useState(toParam)
  const [metric, setMetric] = useState<TimingsMetric>(metricParam)
  const [groupBy, setGroupBy] = useState<TimingsGroupBy>(groupByParam)
  const [groupFilter, setGroupFilter] = useState(groupIdParam)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string>('firstOrders')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const [data, setData] = useState<{
    summary: TimingsSummary
    groups: TimingsGroupRow[]
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateUrl = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (!value) next.delete(key)
        else next.set(key, value)
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  useEffect(() => {
    if (!searchParams.get('from') || !searchParams.get('to')) {
      updateUrl({
        from: DEFAULT_FROM,
        to: DEFAULT_TO,
        metric: 'median',
        groupBy: 'product',
      })
    }
  }, [searchParams, updateUrl])

  useEffect(() => {
    setFrom(fromParam)
    setTo(toParam)
    setMetric((metricParam === 'mean' ? 'mean' : 'median') as TimingsMetric)
    setGroupBy(groupByParam)
    setGroupFilter(groupIdParam)
  }, [fromParam, toParam, metricParam, groupByParam, groupIdParam])

  useEffect(() => {
    if (!shopifyConnection?.id || !workspaceSlug || !from || !to) return
    setLoading(true)
    setError(null)
    const url = `/api/workspaces/${workspaceSlug}/timings?from=${from}&to=${to}&metric=${metric}&groupBy=${groupBy}${groupFilter ? `&groupId=${groupFilter}` : ''}`
    fetch(url)
      .then((res) => res.json())
      .then((d) => {
        if (d.error) {
          setError(d.error)
          setData(null)
          return
        }
        setData({
          summary: d.summary,
          groups: d.groups ?? [],
        })
        setError(null)
      })
      .catch(() => {
        setError('Failed to load timings')
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [workspaceSlug, shopifyConnection?.id, from, to, metric, groupBy, groupFilter])

  const handleFromChange = (v: string) => {
    setFrom(v)
    updateUrl({ from: v })
  }
  const handleToChange = (v: string) => {
    setTo(v)
    updateUrl({ to: v })
  }
  const handleRangeChange = ({ from, to }: { from: string; to: string }) => {
    setFrom(from)
    setTo(to)
    updateUrl({ from, to })
  }
  const handleMetricChange = (v: TimingsMetric) => {
    setMetric(v)
    updateUrl({ metric: v })
  }
  const handleGroupByChange = (v: TimingsGroupBy) => {
    setGroupBy(v)
    setGroupFilter('')
    updateUrl({ groupBy: v, groupId: '', productId: '' })
  }
  const handleGroupChange = (v: string) => {
    setGroupFilter(v)
    updateUrl({ groupId: v, productId: '' })
  }

  const filteredGroups = useMemo(() => {
    let list = data?.groups ?? []
    if (groupFilter) {
      list = list.filter((group) => group.id === groupFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((group) => group.label.toLowerCase().includes(q))
    }
    return list
  }, [data?.groups, groupFilter, search])

  const sortedGroups = useMemo(() => {
    const list = [...filteredGroups]
    list.sort((a, b) => {
      let aVal: number | string
      let bVal: number | string
      switch (sortKey) {
        case 'title':
          aVal = a.label
          bVal = b.label
          break
        case 'firstOrders':
          aVal = a.firstOrders
          bVal = b.firstOrders
          break
        case 'secondOrdersPct':
          aVal = a.secondOrdersPct
          bVal = b.secondOrdersPct
          break
        case 'thirdOrdersPct':
          aVal = a.thirdOrdersPct
          bVal = b.thirdOrdersPct
          break
        case 'fourthOrdersPct':
          aVal = a.fourthOrdersPct
          bVal = b.fourthOrdersPct
          break
        case 'days1to2':
          aVal = a.days1to2 ?? -1
          bVal = b.days1to2 ?? -1
          break
        case 'days2to3':
          aVal = a.days2to3 ?? -1
          bVal = b.days2to3 ?? -1
          break
        case 'days3to4':
          aVal = a.days3to4 ?? -1
          bVal = b.days3to4 ?? -1
          break
        case 'reactivationDays':
          aVal = a.reactivationDays ?? -1
          bVal = b.reactivationDays ?? -1
          break
        default:
          return 0
      }
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }
      return sortOrder === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })
    return list
  }, [filteredGroups, sortKey, sortOrder])

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder(key === 'title' ? 'asc' : 'desc')
    }
  }

  const handleExport = () => {
    const headers = [
      'Product',
      '1st Orders',
      '2nd Orders %',
      '3rd Orders %',
      '4th Orders %',
      '1 -> 2 (days)',
      '2 -> 3 (days)',
      '3 -> 4 (days)',
      'Reactivation (days)',
    ]
    headers[0] = getGroupByLabel(groupBy)
    const rows = sortedGroups.map((group) => [
      group.label,
      group.firstOrders,
      group.secondOrdersPct.toFixed(2),
      group.thirdOrdersPct.toFixed(2),
      group.fourthOrdersPct.toFixed(2),
      group.days1to2?.toFixed(1) ?? '',
      group.days2to3?.toFixed(1) ?? '',
      group.days3to4?.toFixed(1) ?? '',
      group.reactivationDays?.toFixed(1) ?? '',
    ])
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `time-between-orders-${from}-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported')
  }

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  const summary = data?.summary
  const groupByLabel = getGroupByLabel(groupBy)
  const groupByPluralLabel = getGroupByPluralLabel(groupBy)

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconClock className="h-6 w-6 text-[#96bf48]" />
          Time Between Orders
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{workspaceName}</p>
      </div>

      {!shopifyConnection ? (
        <div className="rounded-xl border bg-card shadow-sm p-8 text-center">
          <p className="text-sm font-medium mb-1">No store connected</p>
          <p className="text-xs text-muted-foreground mb-4">
            Connect your Shopify store from the dashboard to view timings.
          </p>
          <Button asChild>
            <Link href={`/w/${workspaceSlug}/dashboard`}>
              <IconPlugConnected className="mr-1.5 h-4 w-4" />
              Go to dashboard
            </Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <TimingsDateRangePopover
              from={from}
              to={to}
              onFromChange={handleFromChange}
              onToChange={handleToChange}
              onRangeChange={handleRangeChange}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-6 text-center text-destructive">
              {error}
            </div>
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    1st Orders
                  </p>
                  <p className="text-xl font-semibold mt-0.5">
                    {summary.firstOrders.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    2nd Orders
                  </p>
                  <p className="text-xl font-semibold mt-0.5">
                    {summary.secondOrdersPct.toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    3rd Orders
                  </p>
                  <p className="text-xl font-semibold mt-0.5">
                    {summary.thirdOrdersPct.toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    4th Orders
                  </p>
                  <p className="text-xl font-semibold mt-0.5">
                    {summary.fourthOrdersPct.toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg border bg-[#96bf48]/10 p-4">
                  <p className="text-xs font-bold text-[#96bf48] uppercase tracking-wider">
                    1 → 2 ({metric === 'median' ? 'Median' : 'Mean'})
                  </p>
                  <p className="text-xl font-bold mt-0.5 text-[#96bf48]">
                    {formatDays(summary.median1to2)}
                  </p>
                </div>
                <div className="rounded-lg border bg-[#96bf48]/10 p-4">
                  <p className="text-xs font-bold text-[#96bf48] uppercase tracking-wider">
                    2 → 3 ({metric === 'median' ? 'Median' : 'Mean'})
                  </p>
                  <p className="text-xl font-bold mt-0.5 text-[#96bf48]">
                    {formatDays(summary.median2to3)}
                  </p>
                </div>
                <div className="rounded-lg border bg-[#96bf48]/10 p-4">
                  <p className="text-xs font-bold text-[#96bf48] uppercase tracking-wider">
                    3 → 4 ({metric === 'median' ? 'Median' : 'Mean'})
                  </p>
                  <p className="text-xl font-bold mt-0.5 text-[#96bf48]">
                    {formatDays(summary.median3to4)}
                  </p>
                </div>
                <div className="rounded-lg border bg-[#96bf48]/10 p-4">
                  <p className="text-xs font-bold text-[#96bf48] uppercase tracking-wider">
                    Reactivation
                  </p>
                  <p className="text-xl font-bold mt-0.5 text-[#96bf48]">
                    {formatDays(summary.reactivationDays, true)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Select value={groupBy} onValueChange={(v) => handleGroupByChange(v as TimingsGroupBy)}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Group by" />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_BY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={groupFilter || '__all__'}
                  onValueChange={(v) =>
                    handleGroupChange(v === '__all__' ? '' : v)
                  }
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder={groupByLabel} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All {groupByPluralLabel}</SelectItem>
                    {(data?.groups ?? []).map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ToggleGroup
                  type="single"
                  value={metric}
                  onValueChange={(v) =>
                    v && handleMetricChange(v as TimingsMetric)
                  }
                  variant="outline"
                  size="sm"
                >
                  <ToggleGroupItem value="median">Median</ToggleGroupItem>
                  <ToggleGroupItem value="mean">Mean</ToggleGroupItem>
                </ToggleGroup>
                <Button variant="outline" size="icon" onClick={handleExport}>
                  <IconDownload className="h-4 w-4" />
                  <span className="sr-only">Export</span>
                </Button>
                <Button variant="outline" size="icon" onClick={handleShare}>
                  <IconShare3 className="h-4 w-4" />
                  <span className="sr-only">Share</span>
                </Button>
              </div>

              <Input
                placeholder={`Search ${groupByPluralLabel}...`}
                className="max-w-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <div className="rounded-lg border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <div className="flex items-center gap-1">
                          {groupByLabel}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={() => handleSort('title')}
                          >
                            {sortKey === 'title' ? (
                              sortOrder === 'desc' ? (
                                <IconArrowDown className="size-3.5" />
                              ) : (
                                <IconArrowUp className="size-3.5" />
                              )
                            ) : (
                              <IconArrowsSort className="size-3.5 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      </TableHead>
                      <TableHead>
                        <div className="flex items-center justify-end gap-1">
                          1st Orders
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={() => handleSort('firstOrders')}
                          >
                            {sortKey === 'firstOrders' ? (
                              sortOrder === 'desc' ? (
                                <IconArrowDown className="size-3.5" />
                              ) : (
                                <IconArrowUp className="size-3.5" />
                              )
                            ) : (
                              <IconArrowsSort className="size-3.5 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      </TableHead>
                      <TableHead className="text-right">2nd Orders %</TableHead>
                      <TableHead className="text-right">3rd Orders %</TableHead>
                      <TableHead className="text-right">4th Orders %</TableHead>
                      <TableHead className="text-right">1 → 2</TableHead>
                      <TableHead className="text-right">2 → 3</TableHead>
                      <TableHead className="text-right">3 → 4</TableHead>
                      <TableHead className="text-right">Reactivation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedGroups.length ? (
                      sortedGroups.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            {row.label}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.firstOrders.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.secondOrdersPct.toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-right">
                            {row.thirdOrdersPct.toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-right">
                            {row.fourthOrdersPct.toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatDays(row.days1to2)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatDays(row.days2to3)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatDays(row.days3to4)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatDays(row.reactivationDays, true)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="h-24 text-center text-muted-foreground"
                        >
                          No {groupByPluralLabel} found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {data?.groups.length === 0 && !loading && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No data for this date range. Sync your Shopify store and ensure
                  you have orders with customer data.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground py-4">
              No timings data yet. Sync your Shopify store from the dashboard.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
