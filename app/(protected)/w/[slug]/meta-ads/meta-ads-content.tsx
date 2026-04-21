'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DateRangeFilter } from '@/components/analytics'
import type { GoalEvaluation } from '@/lib/metrics/goals'
import { KpiGoalLine } from '@/components/goals/kpi-goal-line'
import { usePageInsights } from '@/hooks/use-page-insights'
import { InsightSheet } from '@/components/ai-engine/insight-sheet'

export type CampaignIntent = 'acquisition' | 'non_acquisition' | 'brand' | 'unclassified'

export type MetaAdsCampaignRow = {
  campaignId: string
  campaignName: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  revenue: number
  roas: number
  intent: CampaignIntent
  acqRoas: number | null
  nonAcqRoas: number | null
  ctr: number
  cpc: number
  cpm: number
  funnel?: MetaFunnelRow
}

export type MetaAdsAdsetRow = MetaAdsCampaignRow & {
  adsetId: string
  adsetName: string
}

export type MetaAdsDailyRow = MetaAdsAdsetRow & { date: string }

type IntentSplit = {
  byIntent: Record<
    CampaignIntent,
    { spend: number; revenue: number; campaignCount: number }
  >
  sumSpendByIntent: number
  totalSpend: number
  totalRevenue: number
  spendReconciles: boolean
  revenueReconciles: boolean
  spendDelta: number
  revenueDelta: number
  acquisitionRoas: number | null
  nonAcquisitionPoolRoas: number | null
}

type FunnelBand = 'low' | 'medium' | 'strong' | 'na'

type MetaFunnelRow = {
  impressions: number
  clicks: number
  spend: number
  addToCart: number | null
  checkoutInitiated: number | null
  purchases: number
  attributedRevenue: number
  ctrPct: number
  atcRatePct: number | null
  checkoutPerAtcPct: number | null
  purchasePerCheckoutPct: number | null
  overallCvrPct: number
  costPerAtc: number | null
  costPerCheckout: number | null
  costPerPurchase: number | null
  roas: number
  coverage: string
  diagnostics: {
    atcRate: FunnelBand
    checkoutFromAtc: FunnelBand
    purchaseFromCheckout: FunnelBand
    clickToPurchase: FunnelBand
  }
}

type MetricsResponse = {
  error?: string
  adAccountIds: string[]
  activeAdAccountId: string | null
  totalDailyRows?: number
  view?: 'campaigns' | 'daily'
  groupBy?: 'campaign' | 'adset'
  intentFilter?: string
  intentSplit?: IntentSplit
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
    goalEvaluations?: { meta_roas?: GoalEvaluation }
  } | null
  byCampaign: MetaAdsCampaignRow[]
  byAdset: MetaAdsAdsetRow[]
  dailyRows?: MetaAdsDailyRow[]
  funnel?: {
    coverage: 'meta_full'
    summary: MetaFunnelRow
    note: string
  }
  currency?: string
}

function formatCurrency(value: number, currencyCode: string) {
  const currency = currencyCode?.trim() || 'USD'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
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

const INTENT_OPTIONS = [
  { value: 'all', label: 'All intents' },
  { value: 'acquisition', label: 'Acquisition' },
  { value: 'non_acquisition', label: 'Non-acquisition' },
  { value: 'brand', label: 'Brand' },
  { value: 'unclassified', label: 'Unclassified' },
] as const

function intentLabel(i: CampaignIntent) {
  return INTENT_OPTIONS.find((o) => o.value === i)?.label ?? i
}

export type MetaCreativeAdRow = {
  adId: string
  adName: string
  campaignId: string
  campaignName: string
  adsetId: string | null
  adsetName: string | null
  intent: CampaignIntent
  impressions: number
  clicks: number
  spend: number
  isVideo: boolean
  hookRatePct: number | null
  holdRatePct: number | null
  p25RatePct: number | null
  p50RatePct: number | null
  p75RatePct: number | null
  p95RatePct: number | null
  avgWatchSec: number | null
  ctrPct: number
  roas: number
  conversions: number
  diagnosticLabels: string[]
}

function CreativeAdsTable({
  rows,
  search,
  note,
  totalDailyRows,
  currencyCode,
}: {
  rows: MetaCreativeAdRow[]
  search: string
  note?: string
  totalDailyRows: number
  currencyCode: string
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.trim().toLowerCase()
    return rows.filter(
      (r) =>
        r.adName.toLowerCase().includes(q) ||
        r.adId.toLowerCase().includes(q) ||
        r.campaignName.toLowerCase().includes(q) ||
        (r.campaignId && r.campaignId.toLowerCase().includes(q))
    )
  }, [rows, search])

  const pctOrNa = (v: number | null) =>
    v == null ? (
      <span className="text-muted-foreground">N/A</span>
    ) : (
      <span className="tabular-nums">{v.toFixed(2)}%</span>
    )

  return (
    <div className="overflow-x-auto">
      {note ? (
        <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border-b px-4 py-2">
          {note}
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[140px]">Ad</TableHead>
            <TableHead className="min-w-[120px]">Campaign</TableHead>
            <TableHead>Intent</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Impr</TableHead>
            <TableHead className="text-right">Hook %</TableHead>
            <TableHead className="text-right">Hold %</TableHead>
            <TableHead className="text-right">P25</TableHead>
            <TableHead className="text-right">P50</TableHead>
            <TableHead className="text-right">P75</TableHead>
            <TableHead className="text-right">P95</TableHead>
            <TableHead className="text-right">Avg watch (s)</TableHead>
            <TableHead className="text-right">CTR</TableHead>
            <TableHead className="text-right">ROAS</TableHead>
            <TableHead className="min-w-[180px]">Diagnostics</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={15} className="h-24 text-center text-muted-foreground">
                {search.trim()
                  ? 'No ads match your search.'
                  : 'No ad-level creative data in this range. Run Meta sync after connecting.'}
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r) => (
              <TableRow key={r.adId}>
                <TableCell>
                  <div className="max-w-[200px] truncate font-medium" title={r.adName || r.adId}>
                    {r.adName || r.adId}
                  </div>
                  <div className="text-xs text-muted-foreground truncate max-w-[200px]">{r.adId}</div>
                </TableCell>
                <TableCell>
                  <div className="max-w-[160px] truncate text-sm" title={r.campaignName}>
                    {r.campaignName || r.campaignId}
                  </div>
                </TableCell>
                <TableCell>
                  <IntentBadge intent={r.intent} />
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatCurrency(r.spend, currencyCode)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatNumber(r.impressions)}
                </TableCell>
                <TableCell className="text-right">{pctOrNa(r.hookRatePct)}</TableCell>
                <TableCell className="text-right">{pctOrNa(r.holdRatePct)}</TableCell>
                <TableCell className="text-right">{pctOrNa(r.p25RatePct)}</TableCell>
                <TableCell className="text-right">{pctOrNa(r.p50RatePct)}</TableCell>
                <TableCell className="text-right">{pctOrNa(r.p75RatePct)}</TableCell>
                <TableCell className="text-right">{pctOrNa(r.p95RatePct)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.avgWatchSec == null ? (
                    <span className="text-muted-foreground">N/A</span>
                  ) : (
                    r.avgWatchSec.toFixed(2)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.ctrPct.toFixed(2)}%</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{r.roas.toFixed(2)}x</TableCell>
                <TableCell className="text-sm">
                  {r.diagnosticLabels.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <ul className="list-disc list-inside space-y-0.5 text-amber-800 dark:text-amber-200">
                      {r.diagnosticLabels.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {filtered.length > 0 && (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          {filtered.length} ad{filtered.length !== 1 ? 's' : ''}
          {totalDailyRows > 0 && (
            <>
              {' '}
              · {totalDailyRows} ad-day row{totalDailyRows !== 1 ? 's' : ''} in range
            </>
          )}
          {search.trim() && rows.length !== filtered.length && (
            <> · filtered from {rows.length}</>
          )}
        </div>
      )}
    </div>
  )
}

function bandClass(b: FunnelBand) {
  if (b === 'low') return 'text-amber-600 dark:text-amber-400'
  if (b === 'medium') return 'text-slate-600 dark:text-slate-400'
  if (b === 'strong') return 'text-emerald-600 dark:text-emerald-400'
  return 'text-muted-foreground'
}

function PctCell({
  pct,
  band,
}: {
  pct: number | null
  band: FunnelBand
}) {
  if (pct == null) return <span className="text-muted-foreground">—</span>
  return <span className={bandClass(band)}>{pct.toFixed(2)}%</span>
}

function IntentBadge({ intent }: { intent: CampaignIntent }) {
  const cls =
    intent === 'acquisition'
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
      : intent === 'unclassified'
        ? 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200 ring-1 ring-amber-400/60'
        : intent === 'brand'
          ? 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200'
          : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {intentLabel(intent)}
    </span>
  )
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
  const [intentFilter, setIntentFilter] = useState<string>('all')
  const [adsView, setAdsView] = useState<'performance' | 'funnel' | 'creative'>('performance')

  const insightProps = usePageInsights(slug, 'meta-ads', dateFrom, dateTo)

  const viewParam = view === 'daily' ? 'daily' : 'campaigns'
  const groupByParam = view === 'adsets' ? 'adset' : 'campaign'

  const { data, isLoading, isError, error, refetch } = useQuery<MetricsResponse>({
    queryKey: ['meta-ads', 'metrics', slug, dateFrom, dateTo, viewParam, groupByParam, intentFilter],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${slug}/meta-ads/metrics?from=${dateFrom}&to=${dateTo}&view=${viewParam}&groupBy=${groupByParam}&intent=${encodeURIComponent(intentFilter)}`
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      return json
    },
    enabled: hasConnection,
  })

  type CreativeResponse = {
    ads: MetaCreativeAdRow[]
    note?: string
    formulasNote?: string
    totalDailyRows?: number
  }

  const { data: creativeData, isLoading: creativeLoading } = useQuery<CreativeResponse>({
    queryKey: ['meta-ads', 'creative', slug, dateFrom, dateTo, intentFilter],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${slug}/meta-ads/creative?from=${dateFrom}&to=${dateTo}&intent=${encodeURIComponent(intentFilter)}`
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load creative metrics')
      return json
    },
    enabled: hasConnection && adsView === 'creative',
  })

  const adAccountIds = data?.adAccountIds ?? []
  const activeAdAccountId = data?.activeAdAccountId ?? null
  const currencyCode = data?.currency?.trim() || 'USD'

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
      const intentMatch =
        'intent' in r &&
        intentLabel((r as MetaAdsCampaignRow).intent).toLowerCase().includes(q)
      return campaignMatch || adsetMatch || dateMatch || intentMatch
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
        accessorKey: 'intent',
        header: 'Intent',
        cell: ({ row }) => <IntentBadge intent={row.original.intent} />,
      },
      {
        accessorKey: 'spend',
        header: () => <div className="text-right">Spend</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">
            {formatCurrency(row.original.spend, currencyCode)}
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
            {formatCurrency(row.original.cpc, currencyCode)}
          </div>
        ),
      },
      {
        accessorKey: 'cpm',
        header: () => <div className="text-right">CPM</div>,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground tabular-nums">
            {formatCurrency(row.original.cpm, currencyCode)}
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
            {formatCurrency(row.original.revenue, currencyCode)}
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
      {
        id: 'acqRoas',
        accessorFn: (r) => r.acqRoas ?? -1,
        header: () => <div className="text-right text-xs max-w-[4.5rem] leading-tight">Acq ROAS</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-muted-foreground text-sm">
            {row.original.acqRoas != null ? `${row.original.acqRoas.toFixed(2)}x` : '—'}
          </div>
        ),
      },
      {
        id: 'nonAcqRoas',
        accessorFn: (r) => r.nonAcqRoas ?? -1,
        header: () => (
          <div className="text-right text-xs max-w-[4.5rem] leading-tight">Non-acq ROAS</div>
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-muted-foreground text-sm">
            {row.original.nonAcqRoas != null ? `${row.original.nonAcqRoas.toFixed(2)}x` : '—'}
          </div>
        ),
      },
    ],
    [currencyCode]
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
      {
        accessorKey: 'intent',
        header: 'Intent',
        cell: ({ row }) => <IntentBadge intent={row.original.intent} />,
      },
      ...(campaignColumns.slice(2) as ColumnDef<MetaAdsAdsetRow>[]),
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
        accessorKey: 'intent',
        header: 'Intent',
        cell: ({ row }) => <IntentBadge intent={row.original.intent} />,
      },
      {
        accessorKey: 'spend',
        header: () => <div className="text-right">Spend</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">
            {formatCurrency(row.original.spend, currencyCode)}
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
            {formatCurrency(row.original.revenue, currencyCode)}
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
    [currencyCode]
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

  const funnelRowsForTable = useMemo(() => {
    if (!data?.funnel) return []
    if (view === 'daily') {
      return (data.dailyRows ?? []).map((r) => ({
        key: `${r.campaignId}-${r.adsetId}-${r.date}`,
        label: `${r.date} · ${r.campaignName}`,
        sub: r.adsetName,
        f: r.funnel as MetaFunnelRow,
      }))
    }
    if (view === 'adsets') {
      return (data.byAdset ?? []).map((r) => ({
        key: r.adsetId,
        label: r.adsetName || r.adsetId,
        sub: r.campaignName,
        f: r.funnel as MetaFunnelRow,
      }))
    }
    return (data.byCampaign ?? []).map((r) => ({
      key: r.campaignId,
      label: r.campaignName || r.campaignId,
      sub: '',
      f: r.funnel as MetaFunnelRow,
    }))
  }, [data, view])

  const filteredFunnelRows = useMemo(() => {
    if (!search.trim()) return funnelRowsForTable
    const q = search.trim().toLowerCase()
    return funnelRowsForTable.filter(
      (x) =>
        x.label.toLowerCase().includes(q) ||
        x.sub.toLowerCase().includes(q) ||
        x.key.toLowerCase().includes(q)
    )
  }, [funnelRowsForTable, search])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Meta Ads</h1>
          <p className="text-sm text-muted-foreground">
            Campaign and ad set performance for the selected Meta Ads account.
            Data is aggregated from daily records. Sync from Dashboard or Admin.
          </p>
        </div>
        <InsightSheet
          page="meta-ads"
          from={dateFrom}
          to={dateTo}
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
          pageLoading={isLoading}
        />
      </div>

      <Tabs
        value={adsView}
        onValueChange={(v) => setAdsView(v as 'performance' | 'funnel' | 'creative')}
      >
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
          <TabsTrigger value="creative">Creative</TabsTrigger>
        </TabsList>
      </Tabs>

      {hasError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          {data.error}
        </div>
      )}

      {summary && adsView === 'funnel' && data?.funnel && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">{data.funnel.note}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 text-sm">
            {(
              [
                ['Spend', formatCurrency(data.funnel.summary.spend, currencyCode), null],
                ['Impressions', formatNumber(data.funnel.summary.impressions), null],
                ['Clicks', formatNumber(data.funnel.summary.clicks), null],
                ['CTR', `${data.funnel.summary.ctrPct.toFixed(2)}%`, null],
                [
                  'ATC',
                  formatNumber(data.funnel.summary.addToCart ?? 0, 1),
                  data.funnel.summary.diagnostics.atcRate,
                ],
                [
                  'ATC %',
                  `${(data.funnel.summary.atcRatePct ?? 0).toFixed(2)}%`,
                  data.funnel.summary.diagnostics.atcRate,
                ],
                [
                  'Checkout',
                  formatNumber(data.funnel.summary.checkoutInitiated ?? 0, 1),
                  data.funnel.summary.diagnostics.checkoutFromAtc,
                ],
                [
                  'CI % of ATC',
                  data.funnel.summary.checkoutPerAtcPct != null
                    ? `${data.funnel.summary.checkoutPerAtcPct.toFixed(1)}%`
                    : '—',
                  data.funnel.summary.diagnostics.checkoutFromAtc,
                ],
                [
                  'Purchases',
                  formatNumber(data.funnel.summary.purchases, 2),
                  data.funnel.summary.diagnostics.purchaseFromCheckout,
                ],
                [
                  'CVR',
                  `${data.funnel.summary.overallCvrPct.toFixed(2)}%`,
                  data.funnel.summary.diagnostics.clickToPurchase,
                ],
                ['ROAS', `${data.funnel.summary.roas.toFixed(2)}x`, null],
                [
                  'Cost / ATC',
                  data.funnel.summary.costPerAtc != null
                    ? formatCurrency(data.funnel.summary.costPerAtc, currencyCode)
                    : '—',
                  null,
                ],
                [
                  'Cost / checkout',
                  data.funnel.summary.costPerCheckout != null
                    ? formatCurrency(data.funnel.summary.costPerCheckout, currencyCode)
                    : '—',
                  null,
                ],
                [
                  'Cost / purchase',
                  data.funnel.summary.costPerPurchase != null
                    ? formatCurrency(data.funnel.summary.costPerPurchase, currencyCode)
                    : '—',
                  null,
                ],
              ] as const
            ).map(([label, val, band]) => (
              <div key={label} className="rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </p>
                <p className={`mt-0.5 font-semibold tabular-nums ${band ? bandClass(band) : ''}`}>
                  {val}
                </p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Bands: ATC %, CI÷ATC, Purchase÷Checkout, CVR — heuristic low/medium/strong vs rough
            benchmarks.
          </p>
        </div>
      )}

      {summary && adsView === 'performance' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Spend
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(summary.spend, currencyCode)}
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
                {formatCurrency(summary.revenue, currencyCode)}
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
              {data?.summary?.goalEvaluations?.meta_roas ? (
                <KpiGoalLine
                  metricId="meta_roas"
                  evaluation={data.summary.goalEvaluations.meta_roas}
                  currency={currencyCode}
                />
              ) : null}
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

          {data?.intentSplit && summary.spend > 0 && (
            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Spend by campaign intent</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Platform-attributed revenue ROAS (Meta). Classify in{' '}
                    <Link
                      href={`/w/${slug}/settings/ad-campaigns`}
                      className="underline font-medium text-foreground"
                    >
                      Ad campaigns
                    </Link>
                    .
                  </p>
                </div>
                <div
                  className={`text-xs tabular-nums ${data.intentSplit.spendReconciles && data.intentSplit.revenueReconciles ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
                >
                  {data.intentSplit.spendReconciles && data.intentSplit.revenueReconciles
                    ? '✓ Spend & revenue reconcile to totals'
                    : `Reconcile check: spend Δ${data.intentSplit.spendDelta} · rev Δ${data.intentSplit.revenueDelta}`}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(
                  ['acquisition', 'non_acquisition', 'brand', 'unclassified'] as CampaignIntent[]
                ).map((k) => {
                  const b = data.intentSplit!.byIntent[k]
                  const pct = summary.spend > 0 ? (b.spend / summary.spend) * 100 : 0
                  return (
                    <div
                      key={k}
                      className={
                        k === 'unclassified'
                          ? 'rounded-lg border-2 border-amber-400/70 bg-amber-50/50 dark:bg-amber-950/30 p-3'
                          : 'rounded-lg border bg-muted/30 p-3'
                      }
                    >
                      <p className="text-xs font-medium text-muted-foreground">{intentLabel(k)}</p>
                      <p className="text-lg font-semibold tabular-nums mt-1">
                        {formatCurrency(b.spend, currencyCode)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatPercent(pct)} of spend · {b.campaignCount} campaign
                        {b.campaignCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-4 text-sm border-t pt-3">
                <span>
                  <span className="text-muted-foreground">Acq ROAS (pool): </span>
                  <span className="font-semibold tabular-nums">
                    {data.intentSplit.acquisitionRoas != null
                      ? `${data.intentSplit.acquisitionRoas.toFixed(2)}x`
                      : '—'}
                  </span>
                </span>
                <span>
                  <span className="text-muted-foreground">Non-acq ROAS (pool): </span>
                  <span className="font-semibold tabular-nums">
                    {data.intentSplit.nonAcquisitionPoolRoas != null
                      ? `${data.intentSplit.nonAcquisitionPoolRoas.toFixed(2)}x`
                      : '—'}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">(non-acq + brand + uncl.)</span>
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {hasConnection && (summary != null || adsView === 'creative') && (
        <>
          {adsView === 'creative' && (
            <p className="text-sm text-muted-foreground max-w-3xl">
              Ad-level video metrics (hook, hold, quartiles, watch time) vs clicks and ROAS. Use with
              Funnel to separate creative issues from landing-page problems. Non-video ads show N/A for
              video rates.{' '}
              {creativeData?.formulasNote ? (
                <span className="text-xs block mt-1 opacity-90">{creativeData.formulasNote}</span>
              ) : null}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <DateRangeFilter
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
              fromId="meta-ads-from"
              toId="meta-ads-to"
            />
            <Select value={intentFilter} onValueChange={setIntentFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Intent filter" />
              </SelectTrigger>
              <SelectContent>
                {INTENT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            {adsView !== 'creative' && (
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
            )}
            <Input
              placeholder={
                adsView === 'creative'
                  ? 'Search ad, campaign...'
                  : view === 'daily'
                    ? 'Search campaign, ad set or date...'
                    : 'Search campaign or ad set...'
              }
              className="max-w-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="rounded-lg border bg-card overflow-hidden">
            {adsView === 'creative' ? (
              creativeLoading ? (
                <div className="flex items-center justify-center py-16">
                  <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <CreativeAdsTable
                  rows={creativeData?.ads ?? []}
                  search={search}
                  note={creativeData?.note}
                  totalDailyRows={creativeData?.totalDailyRows ?? 0}
                  currencyCode={currencyCode}
                />
              )
            ) : isLoading ? (
              <div className="flex items-center justify-center py-16">
                <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : adsView === 'funnel' && data?.funnel ? (
              <div className="overflow-x-auto p-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{view === 'daily' ? 'Date / Campaign' : view === 'adsets' ? 'Ad set' : 'Campaign'}</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Impr</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">ATC</TableHead>
                      <TableHead className="text-right">ATC%</TableHead>
                      <TableHead className="text-right">Checkout</TableHead>
                      <TableHead className="text-right">CI%</TableHead>
                      <TableHead className="text-right">Purch</TableHead>
                      <TableHead className="text-right">CVR</TableHead>
                      <TableHead className="text-right">ROAS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFunnelRows.map(({ key, label, sub, f }) => (
                      <TableRow key={key}>
                        <TableCell>
                          <div className="max-w-[200px] truncate font-medium" title={label}>
                            {label}
                          </div>
                          {sub ? (
                            <div className="text-muted-foreground max-w-[200px] truncate text-xs">
                              {sub}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(f.spend, currencyCode)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(f.impressions)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(f.clicks)}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.ctrPct.toFixed(2)}%</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(f.addToCart ?? 0, 1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <PctCell pct={f.atcRatePct} band={f.diagnostics.atcRate} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(f.checkoutInitiated ?? 0, 1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <PctCell pct={f.checkoutPerAtcPct} band={f.diagnostics.checkoutFromAtc} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(f.purchases, 2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <PctCell pct={f.overallCvrPct} band={f.diagnostics.clickToPurchase} />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {f.roas.toFixed(2)}x
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredFunnelRows.length === 0 && (
                  <p className="text-muted-foreground py-8 text-center text-sm">No rows match filters.</p>
                )}
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
