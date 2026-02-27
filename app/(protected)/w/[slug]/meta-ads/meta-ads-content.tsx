'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
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
  IconBrandMeta,
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
import { DateRangeFilter } from '@/components/analytics'

export type MetaAdsCampaignRow = {
  campaignId: string
  campaignName: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  revenue: number
  roas: number
  ctr: number
  cpc: number
  cpm: number
}

export type MetaAdsAdsetRow = MetaAdsCampaignRow & {
  adsetId: string
  adsetName: string
}

export type MetaAdsDailyRow = MetaAdsAdsetRow & { date: string }

type MetricsResponse = {
  error?: string
  adAccountIds: string[]
  activeAdAccountId: string | null
  totalDailyRows?: number
  view?: 'campaigns' | 'daily'
  groupBy?: 'campaign' | 'adset'
  summary: {
    impressions: number
    clicks: number
    spend: number
    conversions: number
    revenue: number
    roas: number
    from: string
    to: string
    days: number
  } | null
  byCampaign: MetaAdsCampaignRow[]
  byAdset: MetaAdsAdsetRow[]
  dailyRows?: MetaAdsDailyRow[]
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

export function MetaAdsContent({
  hasConnection,
  workspaceId,
}: {
  hasConnection: boolean
  workspaceId: string
}) {
  const { current } = useWorkspace()
  const slug = current.slug
  const [dateFrom, setDateFrom] = useState<string>(() => format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'))
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'campaigns' | 'adsets' | 'daily'>('campaigns')
  const [selectingAccount, setSelectingAccount] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'spend', desc: true }])

  const viewParam = view === 'daily' ? 'daily' : 'campaigns'
  const groupByParam = view === 'adsets' ? 'adset' : 'campaign'

  const { data, isLoading, isError, error, refetch } = useQuery<MetricsResponse>({
    queryKey: ['meta-ads', 'metrics', slug, dateFrom, dateTo, viewParam, groupByParam],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${slug}/meta-ads/metrics?from=${dateFrom}&to=${dateTo}&view=${viewParam}&groupBy=${groupByParam}`
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      return json
    },
    enabled: hasConnection,
  })

  const adAccountIds = data?.adAccountIds ?? []
  const activeAdAccountId = data?.activeAdAccountId ?? null

  const handleSelectAccount = async (selectedAdAccountId: string) => {
    if (selectedAdAccountId === activeAdAccountId) return
    setSelectingAccount(true)
    try {
      const res = await fetch('/api/integrations/meta/select-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, selectedAdAccountId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to switch account')
      }
      await refetch()
    } finally {
      setSelectingAccount(false)
    }
  }

  const rowsForView = useMemo(() => {
    if (view === 'daily') return data?.dailyRows ?? []
    if (view === 'adsets') return data?.byAdset ?? []
    return data?.byCampaign ?? []
  }, [view, data?.byCampaign, data?.byAdset, data?.dailyRows])

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rowsForView
    const q = search.trim().toLowerCase()
    return rowsForView.filter((r) => {
      const campaignMatch =
        r.campaignName?.toLowerCase().includes(q) ||
        r.campaignId?.toLowerCase().includes(q)
      const adsetMatch =
        'adsetName' in r &&
        (String((r as MetaAdsAdsetRow).adsetName).toLowerCase().includes(q) ||
          String((r as MetaAdsAdsetRow).adsetId).toLowerCase().includes(q))
      const dateMatch = 'date' in r && (r as MetaAdsDailyRow).date.includes(q)
      return campaignMatch || adsetMatch || dateMatch
    })
  }, [rowsForView, search])

  const campaignColumns = useMemo<ColumnDef<MetaAdsCampaignRow>[]>(
    () => [
      {
        accessorKey: 'campaignName',
        header: 'Campaign',
        cell: ({ row }) => (
          <div
            className="font-medium max-w-[220px] truncate"
            title={row.original.campaignName}
          >
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
        accessorKey: 'ctr',
        header: () => <div className="text-right">CTR</div>,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground tabular-nums">
            {formatPercent(row.original.ctr)}
          </div>
        ),
      },
      {
        accessorKey: 'cpc',
        header: () => <div className="text-right">CPC</div>,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground tabular-nums">
            {formatCurrency(row.original.cpc)}
          </div>
        ),
      },
      {
        accessorKey: 'cpm',
        header: () => <div className="text-right">CPM</div>,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground tabular-nums">
            {formatCurrency(row.original.cpm)}
          </div>
        ),
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
        accessorKey: 'revenue',
        header: () => <div className="text-right">Revenue</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">
            {formatCurrency(row.original.revenue)}
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

  const adsetColumns = useMemo<ColumnDef<MetaAdsAdsetRow>[]>(
    () => [
      {
        accessorKey: 'campaignName',
        header: 'Campaign',
        cell: ({ row }) => (
          <div
            className="font-medium max-w-[160px] truncate"
            title={row.original.campaignName}
          >
            {row.original.campaignName || row.original.campaignId}
          </div>
        ),
      },
      {
        accessorKey: 'adsetName',
        header: 'Ad set',
        cell: ({ row }) => (
          <div
            className="max-w-[160px] truncate text-muted-foreground"
            title={row.original.adsetName}
          >
            {row.original.adsetName || row.original.adsetId || '—'}
          </div>
        ),
      },
      ...(campaignColumns.slice(1) as ColumnDef<MetaAdsAdsetRow>[]),
    ],
    [campaignColumns]
  )

  const dailyColumns = useMemo<ColumnDef<MetaAdsDailyRow>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Date',
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.date}
          </span>
        ),
      },
      {
        accessorKey: 'campaignName',
        header: 'Campaign',
        cell: ({ row }) => (
          <div
            className="font-medium max-w-[140px] truncate"
            title={row.original.campaignName}
          >
            {row.original.campaignName || row.original.campaignId}
          </div>
        ),
      },
      {
        accessorKey: 'adsetName',
        header: 'Ad set',
        cell: ({ row }) => (
          <div
            className="max-w-[140px] truncate text-muted-foreground"
            title={row.original.adsetName}
          >
            {row.original.adsetName || '—'}
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
        accessorKey: 'ctr',
        header: () => <div className="text-right">CTR</div>,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground tabular-nums">
            {formatPercent(row.original.ctr)}
          </div>
        ),
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
        accessorKey: 'revenue',
        header: () => <div className="text-right">Revenue</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">
            {formatCurrency(row.original.revenue)}
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

  type TableRow = MetaAdsCampaignRow | MetaAdsAdsetRow | MetaAdsDailyRow
  const columns: ColumnDef<TableRow>[] =
    view === 'daily'
      ? (dailyColumns as ColumnDef<TableRow>[])
      : view === 'adsets'
        ? (adsetColumns as ColumnDef<TableRow>[])
        : (campaignColumns as ColumnDef<TableRow>[])

  const getRowId = (row: TableRow) => {
    if (view === 'daily') {
      const d = row as MetaAdsDailyRow
      return `${d.campaignId}-${d.adsetId || 'na'}-${d.date}`
    }
    if (view === 'adsets') {
      return (row as MetaAdsAdsetRow).adsetId
    }
    return (row as MetaAdsCampaignRow).campaignId
  }

  const table = useReactTable<TableRow>({
    data: filteredRows as TableRow[],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  })

  if (!hasConnection) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#1877F2]/10 mb-4">
          <IconBrandMeta className="h-6 w-6 text-[#1877F2]" />
        </div>
        <h3 className="font-semibold">Connect Meta Ads</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
          Connect your Meta (Facebook) Ads account from the Dashboard to view
          campaign performance here.
        </p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-destructive">
        {error instanceof Error ? error.message : 'Failed to load Meta Ads data'}
      </div>
    )
  }

  const summary = data?.summary
  const hasError = data?.error && !summary

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Meta Ads</h1>
        <p className="text-sm text-muted-foreground">
          Campaign and ad set performance for the selected Meta Ads account.
          Data is aggregated from daily records. Sync from Dashboard or Admin.
        </p>
      </div>

      {hasError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          {data.error}
        </div>
      )}

      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Spend
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(summary.spend)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.from} – {summary.to}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Revenue
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(summary.revenue)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.from} – {summary.to}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                ROAS
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {summary.roas.toFixed(2)}x
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.from} – {summary.to}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Impressions
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatNumber(summary.impressions)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.from} – {summary.to}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Clicks
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatNumber(summary.clicks)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.from} – {summary.to}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Conversions
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatNumber(summary.conversions, 2)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.from} – {summary.to}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <DateRangeFilter
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
              fromId="meta-ads-from"
              toId="meta-ads-to"
            />
            {adAccountIds.length > 1 && (
              <Select
                value={activeAdAccountId ?? ''}
                onValueChange={handleSelectAccount}
                disabled={selectingAccount}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select account">
                    {selectingAccount
                      ? 'Switching…'
                      : activeAdAccountId
                        ? activeAdAccountId
                        : 'Select account'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {adAccountIds.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={view}
              onValueChange={(v) => setView(v as 'campaigns' | 'adsets' | 'daily')}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="campaigns">Campaign totals</SelectItem>
                <SelectItem value="adsets">Ad set totals</SelectItem>
                <SelectItem value="daily">Daily breakdown</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder={
                view === 'daily'
                  ? 'Search campaign, ad set or date...'
                  : 'Search campaign or ad set...'
              }
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
                <div className="overflow-x-auto">
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
                              ? view === 'daily'
                                ? 'No daily rows match your search.'
                                : 'No rows match your search.'
                              : view === 'daily'
                                ? 'No daily data for this period. Sync from Dashboard or Admin.'
                                : 'No data for this period. Sync from Dashboard or Admin.'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {filteredRows.length > 0 && (
                  <div className="border-t px-4 py-3 text-sm text-muted-foreground">
                    {view === 'daily' ? (
                      <>
                        {filteredRows.length} daily row
                        {filteredRows.length !== 1 ? 's' : ''}
                        {search.trim() &&
                          data?.dailyRows &&
                          data.dailyRows.length !== filteredRows.length && (
                            <> (filtered from {data.dailyRows.length})</>
                          )}
                      </>
                    ) : (
                      <>
                        {filteredRows.length}{' '}
                        {view === 'adsets' ? 'ad set' : 'campaign'}
                        {filteredRows.length !== 1 ? 's' : ''}
                        {typeof data?.totalDailyRows === 'number' && (
                          <>
                            {' '}
                            (aggregated from {data.totalDailyRows} daily record
                            {data.totalDailyRows !== 1 ? 's' : ''})
                          </>
                        )}
                        {search.trim() &&
                          rowsForView.length !== filteredRows.length && (
                            <> · filtered from {rowsForView.length}</>
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
          <p>
            No metrics yet. Select a Meta Ads account on the Dashboard and run a
            sync.
          </p>
        </div>
      )}
    </div>
  )
}
