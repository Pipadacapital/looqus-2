'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { format, subDays, startOfYear, endOfDay } from 'date-fns'
import {
  IconCurrencyDollar,
  IconLoader2,
  IconPlugConnected,
  IconChevronDown,
  IconLayoutColumns,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DateRangeFilter } from '@/components/analytics'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePageInsights } from '@/hooks/use-page-insights'
import { InsightSheet } from '@/components/ai-engine/insight-sheet'
import type { PnLRow } from '@/app/api/workspaces/[slug]/pnl/route'

type Granularity = 'day' | 'week' | 'month' | 'quarter'
type ValueMode = 'absolute' | 'percentage'

const BRAIN_PNL = process.env.NEXT_PUBLIC_BRAIN_PNL_ENABLED === 'true'

function pnlUrl(slug: string, qs: URLSearchParams): string {
  if (BRAIN_PNL) {
    const base = `/api/brain/pnl?slug=${encodeURIComponent(slug)}`
    return `${base}&${qs.toString()}`
  }
  return `/api/workspaces/${slug}/pnl?${qs.toString()}`
}

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
]

/** Column id → header; order matches desired table order. Default visible list from spec. */
const COLUMN_CONFIG: { id: keyof PnLRow; label: string; defaultVisible: boolean }[] = [
  { id: 'label', label: 'Day', defaultVisible: true },
  { id: 'grossSales', label: 'Gross Sales', defaultVisible: false },
  { id: 'productGross', label: 'Product Gross', defaultVisible: false },
  { id: 'shippingGross', label: 'Shipping Gross', defaultVisible: false },
  { id: 'discounts', label: 'Discounts', defaultVisible: true },
  { id: 'productDiscount', label: 'Product Discount', defaultVisible: false },
  { id: 'shippingDiscount', label: 'Shipping Discount', defaultVisible: false },
  { id: 'sales', label: 'Sales', defaultVisible: true },
  { id: 'netSales', label: 'Net Sales', defaultVisible: true },
  { id: 'productNet', label: 'Product Net', defaultVisible: false },
  { id: 'shippingNet', label: 'Shipping Net', defaultVisible: false },
  { id: 'refunds', label: 'Refunds', defaultVisible: true },
  { id: 'productRefunds', label: 'Product Refunds', defaultVisible: true },
  { id: 'shippingRefunds', label: 'Shipping Refunds', defaultVisible: true },
  { id: 'returnFees', label: 'Return Fees', defaultVisible: false },
  { id: 'revenue', label: 'Revenue', defaultVisible: true },
  { id: 'ncNetRevenue', label: 'NC Net Revenue', defaultVisible: false },
  { id: 'ecNetRevenue', label: 'EC Net Revenue', defaultVisible: false },
  { id: 'netRevenue', label: 'Net Revenue', defaultVisible: true },
  { id: 'cogs', label: 'COGS', defaultVisible: true },
  { id: 'variableCosts', label: 'Variable Costs', defaultVisible: true },
  { id: 'shippingCosts', label: 'Shipping Costs', defaultVisible: false },
  { id: 'returnsCosts', label: 'Returns Costs', defaultVisible: false },
  { id: 'paymentCosts', label: 'Payment Costs', defaultVisible: false },
  { id: 'customsCosts', label: 'Customs Costs', defaultVisible: false },
  { id: 'otherVariable', label: 'Other Variable', defaultVisible: false },
  { id: 'adSpend', label: 'Ad Spend', defaultVisible: true },
  { id: 'metaAdSpend', label: 'Meta Ads', defaultVisible: false },
  { id: 'googleAdSpend', label: 'Google Ads', defaultVisible: false },
  { id: 'contributionMargin1', label: 'Contribution Margin 1', defaultVisible: true },
  { id: 'contributionMargin2', label: 'Contribution Margin 2', defaultVisible: true },
  { id: 'contributionMargin3', label: 'Contribution Margin 3', defaultVisible: true },
  { id: 'fixedCosts', label: 'Fixed Costs', defaultVisible: true },
  { id: 'founderSalaryAllocated', label: "Founder's salary", defaultVisible: false },
  { id: 'netProfit', label: 'Net Profit', defaultVisible: true },
]

const NUMERIC_COLUMNS = new Set([
  'grossSales', 'productGross', 'shippingGross', 'discounts', 'productDiscount', 'shippingDiscount',
  'sales', 'netSales', 'productNet', 'shippingNet', 'refunds', 'productRefunds', 'shippingRefunds',
  'returnFees', 'revenue', 'ncNetRevenue', 'ecNetRevenue', 'netRevenue', 'cogs', 'variableCosts',
  'shippingCosts', 'returnsCosts', 'paymentCosts', 'customsCosts', 'otherVariable', 'adSpend',
  'metaAdSpend', 'googleAdSpend', 'contributionMargin1', 'contributionMargin2', 'contributionMargin3',
  'fixedCosts', 'founderSalaryAllocated', 'netProfit',
])

const DEFAULT_VISIBILITY: Record<string, boolean> = {}
COLUMN_CONFIG.forEach((c) => {
  DEFAULT_VISIBILITY[c.id] = c.defaultVisible
})

/** P&L only: uses API `currency` (ISO 4217) with Intl — avoids shared formatCurrency’s INR vs $ shortcut. */
function formatPnlCurrency(
  value: number,
  currencyCode: string,
  opts: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {}
): string {
  const currency = currencyCode?.trim() || 'INR'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: opts.minimumFractionDigits ?? 2,
    maximumFractionDigits: opts.maximumFractionDigits ?? 2,
  }).format(value)
}

// Presets for PnL: Year to date, Last year (in addition to DateRangeFilter presets)
function applyPnlPreset(
  preset: 'ytd' | 'lastYear',
  onFrom: (s: string) => void,
  onTo: (s: string) => void
) {
  const now = new Date()
  if (preset === 'ytd') {
    const yStart = startOfYear(now)
    onFrom(format(yStart, 'yyyy-MM-dd'))
    onTo(format(endOfDay(now), 'yyyy-MM-dd'))
  } else {
    // Last year = previous calendar year (Jan 1 – Dec 31)
    const lastYear = now.getFullYear() - 1
    onFrom(format(new Date(lastYear, 0, 1), 'yyyy-MM-dd'))
    onTo(format(new Date(lastYear, 11, 31), 'yyyy-MM-dd'))
  }
}

type ShopifyConnectionInfo = {
  id: string
  shopDomain: string
  status: string
}

interface PnlContentProps {
  workspaceSlug: string
  workspaceName: string
  workspacePlatform: 'SHOPIFY' | 'WOOCOMMERCE'
  hasStoreConnection: boolean
  shopifyConnection: ShopifyConnectionInfo | null
}

export function PnlContent({
  workspaceSlug,
  workspaceName,
  workspacePlatform,
  hasStoreConnection,
  shopifyConnection,
}: PnlContentProps) {
  const [from, setFrom] = useState<string>(() =>
    format(subDays(new Date(), 29), 'yyyy-MM-dd')
  )
  const [to, setTo] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'))
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [valueMode, setValueMode] = useState<ValueMode>('absolute')
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(DEFAULT_VISIBILITY)
  const [pageSize, setPageSize] = useState(14)
  const [pageIndex, setPageIndex] = useState(0)

  const [data, setData] = useState<{ rows: PnLRow[]; currency: string }>({ rows: [], currency: 'INR' })
  const [loading, setLoading] = useState(
    () => !!workspaceSlug && !!from && !!to && hasStoreConnection
  )
  const [error, setError] = useState<string | null>(null)

  // AI Insight — global job store
  const insightProps = usePageInsights(workspaceSlug, 'pnl', from, to)

  const handleFromChange = (value: string) => {
    setFrom(value)
    setLoading(true)
    setError(null)
  }

  const handleToChange = (value: string) => {
    setTo(value)
    setLoading(true)
    setError(null)
  }

  const handleApplyPreset = (preset: 'ytd' | 'lastYear') => {
    applyPnlPreset(preset, handleFromChange, handleToChange)
  }

  useEffect(() => {
    if (!workspaceSlug || !from || !to) return
    const qs = new URLSearchParams({ from, to, granularity })
    fetch(pnlUrl(workspaceSlug, qs))
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error)
          setData({ rows: [], currency: 'INR' })
        } else {
          setData({ rows: json.rows ?? [], currency: json.currency ?? 'INR' })
        }
      })
      .catch(() => {
        setError('Failed to load P&L data')
        setData({ rows: [], currency: 'INR' })
      })
      .finally(() => setLoading(false))
  }, [workspaceSlug, from, to, granularity])

  const visibleColumns = useMemo(
    () => COLUMN_CONFIG.filter((c) => c.id === 'label' || columnVisibility[c.id]),
    [columnVisibility]
  )

  const paginatedRows = useMemo(() => {
    const start = pageIndex * pageSize
    return data.rows.slice(start, start + pageSize)
  }, [data.rows, pageIndex, pageSize])

  const totalRow = useMemo(() => {
    if (data.rows.length === 0) return null
    const first = data.rows[0]
    const total: Record<string, number> = { label: 'Total' as unknown as number }
    for (const key of Object.keys(first) as (keyof PnLRow)[]) {
      if (key === 'label' || key === 'bucketKey') continue
      if (typeof (first as Record<string, unknown>)[key] === 'number') {
        (total as Record<string, number>)[key] = data.rows.reduce(
          (sum, r) => sum + ((r as unknown as Record<string, number>)[key] ?? 0),
          0
        )
      }
    }
    return total as unknown as Partial<PnLRow> & { label: string }
  }, [data.rows])

  const totalNetSales = useMemo(
    () => data.rows.reduce((s, r) => s + r.netSales, 0),
    [data.rows]
  )

  function formatCellValue(
    key: keyof PnLRow,
    value: number,
    netSalesRow: number
  ): string {
    if (valueMode !== 'percentage' || !NUMERIC_COLUMNS.has(key)) {
      return formatPnlCurrency(value, data.currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    const base = netSalesRow || totalNetSales || 1
    const pct = (value / base) * 100
    return `${pct.toFixed(1)}%`
  }

  const totalPages = Math.max(1, Math.ceil(data.rows.length / pageSize))

  if (!hasStoreConnection) {
    return (
      <div className="flex flex-col gap-6 py-4 md:py-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconCurrencyDollar className="h-6 w-6 text-[#96bf48]" />
          P&L
        </h1>
        <div className="rounded-xl border bg-card shadow-sm p-8 text-center">
          <p className="text-sm font-medium mb-1">No store connected</p>
          <p className="text-xs text-muted-foreground mb-4">
            Connect your {workspacePlatform === 'WOOCOMMERCE' ? 'WooCommerce' : 'Shopify'} store from Integrations to view P&L.
          </p>
          <Button asChild>
            <Link href={`/w/${workspaceSlug}/dashboard`}>
              <IconPlugConnected className="mr-1.5 h-4 w-4" />
              Go to dashboard
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconCurrencyDollar className="h-6 w-6 text-[#96bf48]" />
            P&L
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{workspaceName}</p>
        </div>

        {hasStoreConnection && (
          <InsightSheet
            page="pnl"
            from={from}
            to={to}
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
            pageLoading={loading}
          />
        )}
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-4 border-b px-6 py-4">
          <DateRangeFilter
            from={from}
            to={to}
            onFromChange={handleFromChange}
            onToChange={handleToChange}
            fromId="pnl-from"
            toId="pnl-to"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => handleApplyPreset('ytd')}
          >
            Year to date
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => handleApplyPreset('lastYear')}
          >
            Last year
          </Button>

          <div className="flex items-center gap-2 ml-auto">
            <div className="flex rounded-md border bg-muted/30 p-0.5">
              <Button
                variant={valueMode === 'absolute' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setValueMode('absolute')}
              >
                Absolute
              </Button>
              <Button
                variant={valueMode === 'percentage' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setValueMode('percentage')}
              >
                Percentage
              </Button>
            </div>
            <div className="flex rounded-md border bg-muted/30 p-0.5">
              {GRANULARITY_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant={granularity === opt.value ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setGranularity(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <IconLayoutColumns className="mr-1.5 h-4 w-4" />
                  Columns
                  <IconChevronDown className="ml-1.5 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-[70vh] overflow-y-auto">
                {COLUMN_CONFIG.filter((c) => c.id !== 'label').map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={columnVisibility[c.id] ?? false}
                    onCheckedChange={(checked) =>
                      setColumnVisibility((prev) => ({ ...prev, [c.id]: !!checked }))
                    }
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {valueMode === 'percentage' && (
          <p className="px-6 py-1 text-xs text-muted-foreground border-b">
            Percentage mode: monetary columns shown as % of Net Sales (row or total).
          </p>
        )}

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-16">
              <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="px-6 py-8 text-sm text-destructive">{error}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map((c) => (
                      <TableHead key={c.id} className="whitespace-nowrap">
                        {c.id === 'label' ? (granularity.charAt(0).toUpperCase() + granularity.slice(1)) : c.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRows.map((row) => (
                    <TableRow key={row.bucketKey}>
                      {visibleColumns.map((col) => (
                        <TableCell key={col.id} className="whitespace-nowrap">
                          {col.id === 'label'
                            ? row.label
                            : typeof (row as Record<string, unknown>)[col.id] === 'number'
                              ? formatCellValue(
                                  col.id as keyof PnLRow,
                                  (row as unknown as Record<string, number>)[col.id],
                                  row.netSales
                                )
                              : String((row as unknown as Record<string, unknown>)[col.id] ?? '')}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
                {totalRow && paginatedRows.length > 0 && (
                  <TableBody>
                    <TableRow className="bg-muted/50 font-medium">
                      {visibleColumns.map((col) => (
                        <TableCell key={col.id} className="whitespace-nowrap">
                          {col.id === 'label'
                            ? totalRow.label
                            : typeof totalRow[col.id as keyof PnLRow] === 'number'
                              ? formatCellValue(
                                  col.id as keyof PnLRow,
                                  totalRow[col.id as keyof PnLRow] as number,
                                  totalNetSales
                                )
                              : ''}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                )}
              </Table>

              <div className="flex items-center justify-between px-6 py-3 border-t">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Rows per page</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v))
                      setPageIndex(0)
                    }}
                  >
                    <SelectTrigger className="w-16 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 14, 20, 30, 50].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pageIndex === 0}
                    onClick={() => setPageIndex(0)}
                  >
                    «
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pageIndex === 0}
                    onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                  >
                    ‹
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pageIndex >= totalPages - 1}
                    onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    ›
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pageIndex >= totalPages - 1}
                    onClick={() => setPageIndex(totalPages - 1)}
                  >
                    »
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
