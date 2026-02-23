'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import {
  IconLoader2,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
  IconBrandGoogle,
} from '@tabler/icons-react'
import { useWorkspace } from '@/hooks/use-workspace'
import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'

export type GoogleAdsCampaignRow = {
  campaignId: string
  campaignName: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  conversionValue: number
  roas: number
}

export type GoogleAdsDailyRow = GoogleAdsCampaignRow & { date: string }

type MetricsResponse = {
  error?: string
  customerIds: string[]
  activeCustomerId: string | null
  totalDailyRows?: number
  view?: 'campaigns' | 'daily'
  summary: {
    impressions: number
    clicks: number
    spend: number
    conversions: number
    conversionValue: number
    roas: number
    from: string
    to: string
    days: number
  } | null
  byCampaign: GoogleAdsCampaignRow[]
  dailyRows?: GoogleAdsDailyRow[]
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)
}

function formatNumber(value: number, decimals = 0) {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value)
}

function formatPercent(value: number) {
  if (value === 0) return '0%'
  return new Intl.NumberFormat('en-IN', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100)
}

export function GoogleAdsContent({
  hasConnection,
  workspaceId,
}: {
  hasConnection: boolean
  workspaceId: string
}) {
  const { current } = useWorkspace()
  const slug = current.slug
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'campaigns' | 'daily'>('campaigns')
  const [selectingCustomer, setSelectingCustomer] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'spend', desc: true },
  ])

  const { data, isLoading, isError, error, refetch } = useQuery<MetricsResponse>({
    queryKey: ['google-ads', 'metrics', slug, days, view],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${slug}/google-ads/metrics?days=${days}&view=${view}`
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      return json
    },
    enabled: hasConnection,
  })

  const customerIds = data?.customerIds ?? []
  const activeCustomerId = data?.activeCustomerId ?? null

  const handleSelectCustomer = async (selectedCustomerId: string) => {
    if (selectedCustomerId === activeCustomerId) return
    setSelectingCustomer(true)
    try {
      const res = await fetch('/api/integrations/google/select-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, selectedCustomerId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to switch account')
      }
      await refetch()
    } finally {
      setSelectingCustomer(false)
    }
  }

  const filteredRows = useMemo(() => {
    if (view === 'daily') {
      const list = data?.dailyRows ?? []
      if (!search.trim()) return list
      const q = search.trim().toLowerCase()
      return list.filter(
        (r) =>
          r.campaignName.toLowerCase().includes(q) ||
          r.campaignId.toLowerCase().includes(q) ||
          r.date.includes(q)
      )
    }
    const list = data?.byCampaign ?? []
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(
      (r) =>
        r.campaignName.toLowerCase().includes(q) ||
        r.campaignId.toLowerCase().includes(q)
    )
  }, [view, data?.byCampaign, data?.dailyRows, search])

  const campaignColumns = useMemo<ColumnDef<GoogleAdsCampaignRow>[]>(
    () => [
      {
        accessorKey: 'campaignName',
        header: 'Campaign',
        cell: ({ row }) => (
          <div className="font-medium max-w-[220px] truncate" title={row.original.campaignName}>
            {row.original.campaignName || row.original.campaignId}
          </div>
        ),
      },
      {
        accessorKey: 'spend',
        header: () => <div className="text-right">Spend</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">
            {formatCurrency(row.original.spend)}
          </div>
        ),
      },
      {
        accessorKey: 'impressions',
        header: () => <div className="text-right">Impressions</div>,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground tabular-nums">
            {formatNumber(row.original.impressions)}
          </div>
        ),
      },
      {
        accessorKey: 'clicks',
        header: () => <div className="text-right">Clicks</div>,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground tabular-nums">
            {formatNumber(row.original.clicks)}
          </div>
        ),
      },
      {
        id: 'ctr',
        accessorFn: (row) => (row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0),
        header: () => <div className="text-right">CTR</div>,
        cell: ({ row }) => {
          const ctr =
            row.original.impressions > 0
              ? (row.original.clicks / row.original.impressions) * 100
              : 0
          return (
            <div className="text-right text-muted-foreground tabular-nums">
              {formatPercent(ctr)}
            </div>
          )
        },
      },
      {
        accessorKey: 'conversions',
        header: () => <div className="text-right">Conversions</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">
            {formatNumber(row.original.conversions, 2)}
          </div>
        ),
      },
      {
        accessorKey: 'conversionValue',
        header: () => <div className="text-right">Conv. value</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">
            {formatCurrency(row.original.conversionValue)}
          </div>
        ),
      },
      {
        accessorKey: 'roas',
        header: () => <div className="text-right">ROAS</div>,
        cell: ({ row }) => (
          <div className="text-right font-semibold tabular-nums">
            {row.original.roas.toFixed(2)}x
          </div>
        ),
      },
    ],
    []
  )

  const dailyColumns = useMemo<ColumnDef<GoogleAdsDailyRow>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Date',
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">{row.original.date}</span>
        ),
      },
      {
        accessorKey: 'campaignName',
        header: 'Campaign',
        cell: ({ row }) => (
          <div className="font-medium max-w-[220px] truncate" title={row.original.campaignName}>
            {row.original.campaignName || row.original.campaignId}
          </div>
        ),
      },
      {
        accessorKey: 'spend',
        header: () => <div className="text-right">Spend</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">
            {formatCurrency(row.original.spend)}
          </div>
        ),
      },
      {
        accessorKey: 'impressions',
        header: () => <div className="text-right">Impressions</div>,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground tabular-nums">
            {formatNumber(row.original.impressions)}
          </div>
        ),
      },
      {
        accessorKey: 'clicks',
        header: () => <div className="text-right">Clicks</div>,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground tabular-nums">
            {formatNumber(row.original.clicks)}
          </div>
        ),
      },
      {
        id: 'ctr',
        accessorFn: (row) => (row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0),
        header: () => <div className="text-right">CTR</div>,
        cell: ({ row }) => {
          const ctr =
            row.original.impressions > 0
              ? (row.original.clicks / row.original.impressions) * 100
              : 0
          return (
            <div className="text-right text-muted-foreground tabular-nums">
              {formatPercent(ctr)}
            </div>
          )
        },
      },
      {
        accessorKey: 'conversions',
        header: () => <div className="text-right">Conversions</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">
            {formatNumber(row.original.conversions, 2)}
          </div>
        ),
      },
      {
        accessorKey: 'conversionValue',
        header: () => <div className="text-right">Conv. value</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">
            {formatCurrency(row.original.conversionValue)}
          </div>
        ),
      },
      {
        accessorKey: 'roas',
        header: () => <div className="text-right">ROAS</div>,
        cell: ({ row }) => (
          <div className="text-right font-semibold tabular-nums">
            {row.original.roas.toFixed(2)}x
          </div>
        ),
      },
    ],
    []
  )

  type TableRow = GoogleAdsCampaignRow | GoogleAdsDailyRow
  const columns: ColumnDef<TableRow>[] = view === 'daily' ? (dailyColumns as ColumnDef<TableRow>[]) : (campaignColumns as ColumnDef<TableRow>[])
  const table = useReactTable<TableRow>({
    data: filteredRows as TableRow[],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => (view === 'daily' ? `${(row as GoogleAdsDailyRow).campaignId}-${(row as GoogleAdsDailyRow).date}` : (row as GoogleAdsCampaignRow).campaignId),
  })

  if (!hasConnection) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#4285F4]/10 mb-4">
          <IconBrandGoogle className="h-6 w-6 text-[#4285F4]" />
        </div>
        <h3 className="font-semibold">Connect Google Ads</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
          Connect your Google Ads account from the Dashboard to view campaign performance here.
        </p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-destructive">
        {error instanceof Error ? error.message : 'Failed to load Google Ads data'}
      </div>
    )
  }

  const summary = data?.summary
  const hasError = data?.error && !summary

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Google Ads</h1>
        <p className="text-sm text-muted-foreground">
          Campaign performance for the selected Google Ads account. Data is aggregated from daily records (one row per campaign per day in DB). Sync from Dashboard or Admin.
        </p>
      </div>

      {hasError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          {data.error}
        </div>
      )}

      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Spend</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(summary.spend)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last {summary.days} days
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conversions</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatNumber(summary.conversions, 2)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last {summary.days} days
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conversion value</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(summary.conversionValue)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last {summary.days} days
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ROAS</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{summary.roas.toFixed(2)}x</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last {summary.days} days
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {customerIds.length > 0 && (
              <Select
                value={activeCustomerId ?? ''}
                onValueChange={handleSelectCustomer}
                disabled={selectingCustomer}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select account">
                    {selectingCustomer ? 'Switching…' : activeCustomerId ? `Account ${activeCustomerId}` : 'Select account'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {customerIds.map((id) => (
                    <SelectItem key={id} value={id}>
                      Account {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={view} onValueChange={(v) => setView(v as 'campaigns' | 'daily')}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="campaigns">Campaign totals</SelectItem>
                <SelectItem value="daily">Daily breakdown (all rows)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder={view === 'daily' ? 'Search campaigns or date...' : 'Search campaigns...'}
              className="max-w-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="rounded-lg border bg-card overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => {
                          const canSort = header.column.getCanSort()
                          const isSorted = header.column.getIsSorted()
                          return (
                            <TableHead key={header.id}>
                              <div className="flex items-center gap-1">
                                {header.isPlaceholder
                                  ? null
                                  : flexRender(
                                      header.column.columnDef.header,
                                      header.getContext()
                                    )}
                                {canSort && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6 shrink-0"
                                    onClick={() =>
                                      header.column.toggleSorting(
                                        header.column.getIsSorted() === 'asc'
                                      )
                                    }
                                  >
                                    {isSorted === 'desc' ? (
                                      <IconArrowDown className="size-3.5" />
                                    ) : isSorted === 'asc' ? (
                                      <IconArrowUp className="size-3.5" />
                                    ) : (
                                      <IconArrowsSort className="size-3.5 text-muted-foreground" />
                                    )}
                                  </Button>
                                )}
                              </div>
                            </TableHead>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.length ? (
                      table.getRowModel().rows.map((row) => (
                        <TableRow key={row.id}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={columns.length}
                          className="h-24 text-center text-muted-foreground"
                        >
                          {search.trim()
                            ? (view === 'daily' ? 'No daily rows match your search.' : 'No campaigns match your search.')
                            : 'No campaign data for this period. Sync from Dashboard or Admin.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                {filteredRows.length > 0 && (
                  <div className="border-t px-4 py-3 text-sm text-muted-foreground">
                    {view === 'daily' ? (
                      <>
                        {filteredRows.length} daily row{filteredRows.length !== 1 ? 's' : ''}
                        {search.trim() && data?.dailyRows && data.dailyRows.length !== filteredRows.length && (
                          <> (filtered from {data.dailyRows.length})</>
                        )}
                      </>
                    ) : (
                      <>
                        {filteredRows.length} campaign{filteredRows.length !== 1 ? 's' : ''}
                        {typeof data?.totalDailyRows === 'number' && (
                          <> (aggregated from {data.totalDailyRows} daily record{data.totalDailyRows !== 1 ? 's' : ''})</>
                        )}
                        {search.trim() && data?.byCampaign && data.byCampaign.length !== filteredRows.length && (
                          <> · filtered from {data.byCampaign.length}</>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {!isLoading && !summary && !hasError && hasConnection && (
        <div className="rounded-lg border bg-muted/30 p-8 text-center text-muted-foreground">
          <p>No metrics yet. Select a Google Ads customer on the Dashboard and run a sync.</p>
        </div>
      )}
    </div>
  )
}
