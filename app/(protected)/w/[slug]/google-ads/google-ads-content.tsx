'use client'

import { useMemo, useState, type ReactNode } from 'react'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DateRangeFilter } from '@/components/analytics'
import type { GoalEvaluation } from '@/lib/metrics/goals'
import { KpiGoalLine } from '@/components/goals/kpi-goal-line'

export type CampaignIntent = 'acquisition' | 'non_acquisition' | 'brand' | 'unclassified'

type FunnelBandG = 'low' | 'medium' | 'strong' | 'na'

export type GoogleFunnelRow = {
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
  coverage: 'google_purchase_only' | 'google_full' | string
  diagnostics: {
    atcRate: FunnelBandG
    checkoutFromAtc: FunnelBandG
    purchaseFromCheckout: FunnelBandG
    clickToPurchase: FunnelBandG
  }
}

export type GoogleAdsCampaignRow = {
  campaignId: string
  campaignName: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  conversionValue: number
  roas: number
  intent: CampaignIntent
  acqRoas: number | null
  nonAcqRoas: number | null
  funnel?: GoogleFunnelRow
}

export type GoogleAdsDailyRow = GoogleAdsCampaignRow & { date: string }

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

type MetricsResponse = {
  error?: string
  customerIds: string[]
  activeCustomerId: string | null
  totalDailyRows?: number
  view?: 'campaigns' | 'daily'
  intentFilter?: string
  intentSplit?: IntentSplit
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
    goalEvaluations?: { google_roas?: GoalEvaluation }
  } | null
  byCampaign: GoogleAdsCampaignRow[]
  dailyRows?: GoogleAdsDailyRow[]
  funnel?: {
    coverage: 'google_purchase_only' | 'google_full'
    hasStagedData?: boolean
    summary: GoogleFunnelRow
    note: string
  }
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

function bandClass(b: FunnelBandG) {
  if (b === 'low') return 'text-amber-600 dark:text-amber-400'
  if (b === 'medium') return 'text-slate-600 dark:text-slate-400'
  if (b === 'strong') return 'text-emerald-600 dark:text-emerald-400'
  return 'text-muted-foreground'
}

function FunnelPct({
  pct,
  band,
}: {
  pct: number | null | undefined
  band: FunnelBandG
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

export function GoogleAdsContent({
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
  const [view, setView] = useState<'campaigns' | 'daily'>('campaigns')
  const [selectingCustomer, setSelectingCustomer] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'spend', desc: true },
  ])
  const [intentFilter, setIntentFilter] = useState('all')
  const [adsView, setAdsView] = useState<'performance' | 'funnel'>('performance')

  const { data, isLoading, isError, error, refetch } = useQuery<MetricsResponse>({
    queryKey: ['google-ads', 'metrics', slug, dateFrom, dateTo, view, intentFilter],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${slug}/google-ads/metrics?from=${dateFrom}&to=${dateTo}&view=${view}&intent=${encodeURIComponent(intentFilter)}`
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
        r.date.includes(q) ||
        intentLabel(r.intent).toLowerCase().includes(q)
    )
    }
    const list = data?.byCampaign ?? []
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(
      (r) =>
        r.campaignName.toLowerCase().includes(q) ||
        r.campaignId.toLowerCase().includes(q) ||
        intentLabel(r.intent).toLowerCase().includes(q)
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
        accessorKey: 'intent',
        header: 'Intent',
        cell: ({ row }) => <IntentBadge intent={row.original.intent} />,
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
      {
        id: 'acqRoas',
        accessorFn: (r) => r.acqRoas ?? -1,
        header: () => <div className="text-right text-xs max-w-[4.5rem]">Acq ROAS</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-muted-foreground text-sm">
            {row.original.acqRoas != null ? `${row.original.acqRoas.toFixed(2)}x` : '—'}
          </div>
        ),
      },
      {
        id: 'nonAcqRoas',
        accessorFn: (r) => r.nonAcqRoas ?? -1,
        header: () => <div className="text-right text-xs max-w-[4.5rem]">Non-acq ROAS</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-muted-foreground text-sm">
            {row.original.nonAcqRoas != null ? `${row.original.nonAcqRoas.toFixed(2)}x` : '—'}
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
        accessorKey: 'intent',
        header: 'Intent',
        cell: ({ row }) => <IntentBadge intent={row.original.intent} />,
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

  const googleFunnelRows = useMemo(() => {
    if (!data?.funnel) return []
    if (view === 'daily') {
      return (data.dailyRows ?? []).map((r) => ({
        key: `${r.campaignId}-${r.date}`,
        label: `${r.date} · ${r.campaignName}`,
        f: r.funnel as GoogleFunnelRow,
      }))
    }
    return (data.byCampaign ?? []).map((r) => ({
      key: r.campaignId,
      label: r.campaignName || r.campaignId,
      f: r.funnel as GoogleFunnelRow,
    }))
  }, [data, view])

  const filteredGoogleFunnelRows = useMemo(() => {
    if (!search.trim()) return googleFunnelRows
    const q = search.trim().toLowerCase()
    return googleFunnelRows.filter((x) => x.label.toLowerCase().includes(q) || x.key.toLowerCase().includes(q))
  }, [googleFunnelRows, search])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Google Ads</h1>
        <p className="text-sm text-muted-foreground">
          Campaign performance for the selected Google Ads account. Data is aggregated from daily records (one row per campaign per day in DB). Sync from Dashboard or Admin.
        </p>
      </div>

      <Tabs value={adsView} onValueChange={(v) => setAdsView(v as 'performance' | 'funnel')}>
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
        </TabsList>
      </Tabs>

      {hasError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          {data.error}
        </div>
      )}

      {summary && adsView === 'funnel' && data?.funnel && (
        <div
          className={`space-y-3 rounded-xl border p-4 ${
            data.funnel.coverage === 'google_full'
              ? 'bg-card'
              : 'border-amber-200/50 bg-amber-50/30 dark:bg-amber-950/20'
          }`}
        >
          <p
            className={
              data.funnel.coverage === 'google_full'
                ? 'text-muted-foreground text-sm'
                : 'text-sm text-amber-900 dark:text-amber-200'
            }
          >
            {data.funnel.note}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 text-sm">
            {(() => {
              const s = data.funnel.summary
              const full = s.coverage === 'google_full'
              const cells: [string, ReactNode][] = [
                ['Spend', formatCurrency(s.spend)],
                ['Impressions', formatNumber(s.impressions)],
                ['Clicks', formatNumber(s.clicks)],
                ['CTR', `${s.ctrPct.toFixed(2)}%`],
                [
                  'ATC',
                  full ? formatNumber(s.addToCart ?? 0, 1) : '—',
                ],
                [
                  'ATC %',
                  full ? (
                    <FunnelPct pct={s.atcRatePct} band={s.diagnostics.atcRate} />
                  ) : (
                    '—'
                  ),
                ],
                [
                  'Checkout',
                  full ? formatNumber(s.checkoutInitiated ?? 0, 1) : '—',
                ],
                [
                  'CI % of ATC',
                  full ? (
                    <FunnelPct pct={s.checkoutPerAtcPct} band={s.diagnostics.checkoutFromAtc} />
                  ) : (
                    '—'
                  ),
                ],
                ['Purchases', formatNumber(s.purchases, 2)],
                [
                  'Pur % checkout',
                  full ? (
                    <FunnelPct
                      pct={s.purchasePerCheckoutPct}
                      band={s.diagnostics.purchaseFromCheckout}
                    />
                  ) : (
                    '—'
                  ),
                ],
                [
                  'CVR',
                  <span className={bandClass(s.diagnostics.clickToPurchase)}>
                    {s.overallCvrPct.toFixed(2)}%
                  </span>,
                ],
                ['ROAS', `${s.roas.toFixed(2)}x`],
              ]
              if (full && s.costPerAtc != null) {
                cells.push(['Cost/ATC', formatCurrency(s.costPerAtc)])
                if (s.costPerCheckout != null)
                  cells.push(['Cost/CI', formatCurrency(s.costPerCheckout)])
                if (s.costPerPurchase != null)
                  cells.push(['Cost/Purch', formatCurrency(s.costPerPurchase)])
              }
              return cells.map(([label, val], i) => (
                <div key={`${label}-${i}`} className="rounded-lg border bg-muted/20 px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <div className="mt-0.5 font-semibold tabular-nums">{val}</div>
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {summary && adsView === 'performance' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Spend</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(summary.spend)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.from} – {summary.to}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conversions</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatNumber(summary.conversions, 2)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.from} – {summary.to}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conversion value</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(summary.conversionValue)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.from} – {summary.to}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ROAS</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{summary.roas.toFixed(2)}x</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.from} – {summary.to}
              </p>
              {data?.summary?.goalEvaluations?.google_roas ? (
                <KpiGoalLine
                  metricId="google_roas"
                  evaluation={data.summary.goalEvaluations.google_roas}
                  currency="INR"
                />
              ) : null}
            </div>
          </div>

          {data?.intentSplit && summary.spend > 0 && (
            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Spend by campaign intent</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ROAS uses Google conversion value. Classify in{' '}
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
                  className={`text-xs tabular-nums ${data.intentSplit.spendReconciles && data.intentSplit.revenueReconciles ? 'text-emerald-600' : 'text-destructive'}`}
                >
                  {data.intentSplit.spendReconciles && data.intentSplit.revenueReconciles
                    ? '✓ Spend & conv. value reconcile'
                    : `Δ spend ${data.intentSplit.spendDelta} · Δ value ${data.intentSplit.revenueDelta}`}
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
                        {formatCurrency(b.spend)}
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

      {summary && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <DateRangeFilter
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
              fromId="google-ads-from"
              toId="google-ads-to"
            />
            <Select value={intentFilter} onValueChange={setIntentFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Intent" />
              </SelectTrigger>
              <SelectContent>
                {INTENT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            ) : adsView === 'funnel' && data?.funnel ? (
              <div className="overflow-x-auto p-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{view === 'daily' ? 'Date / Campaign' : 'Campaign'}</TableHead>
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
                    {filteredGoogleFunnelRows.map(({ key, label, f }) => {
                      const full = f.coverage === 'google_full'
                      return (
                        <TableRow key={key}>
                          <TableCell className="max-w-[220px] truncate font-medium" title={label}>
                            {label}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(f.spend)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(f.impressions)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(f.clicks)}</TableCell>
                          <TableCell className="text-right tabular-nums">{f.ctrPct.toFixed(2)}%</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {full ? formatNumber(f.addToCart ?? 0, 1) : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {full ? (
                              <FunnelPct pct={f.atcRatePct} band={f.diagnostics.atcRate} />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {full ? formatNumber(f.checkoutInitiated ?? 0, 1) : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {full ? (
                              <FunnelPct pct={f.checkoutPerAtcPct} band={f.diagnostics.checkoutFromAtc} />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(f.purchases, 2)}</TableCell>
                          <TableCell
                            className={`text-right tabular-nums font-medium ${bandClass(f.diagnostics.clickToPurchase)}`}
                          >
                            {f.overallCvrPct.toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{f.roas.toFixed(2)}x</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                {filteredGoogleFunnelRows.length === 0 && (
                  <p className="text-muted-foreground py-8 text-center text-sm">No rows match filters.</p>
                )}
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
