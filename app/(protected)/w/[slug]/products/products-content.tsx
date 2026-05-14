'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { format, subDays, startOfYear, endOfDay } from 'date-fns'
import {
  IconLoader2,
  IconShoppingBag,
  IconChevronDown,
  IconLayoutColumns,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
  IconFilter,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import type { ProductsRow } from '@/lib/products/types'
import type { ProductsGroupBy, ProductsSortColumn } from '@/lib/products/types'
import { usePageInsights } from '@/hooks/use-page-insights'
import { InsightSheet } from '@/components/ai-engine/insight-sheet'

const GROUP_BY_OPTIONS: { value: ProductsGroupBy; label: string; searchPlaceholder: string }[] = [
  { value: 'product', label: 'Product', searchPlaceholder: 'Search products' },
  { value: 'variant', label: 'Variant', searchPlaceholder: 'Search variants' },
  { value: 'collection', label: 'Collection', searchPlaceholder: 'Search collections' },
  { value: 'vendor', label: 'Vendor', searchPlaceholder: 'Search vendors' },
  { value: 'type', label: 'Type', searchPlaceholder: 'Search types' },
  { value: 'product_tags', label: 'Product Tags', searchPlaceholder: 'Search product tags' },
  { value: 'order_tags', label: 'Order Tags', searchPlaceholder: 'Search order tags' },
  { value: 'discount_codes', label: 'Discount Codes', searchPlaceholder: 'Search discount codes' },
]

const COLUMN_CONFIG: {
  id: keyof ProductsRow | 'cm1_pct' | 'cm1_total' | 'net_quantity' | 'return_rate' | 'nc_return_rate' | 'ec_return_rate' | 'nc_orders' | 'ec_orders' | 'nc_aov' | 'ec_aov'
  label: string
  defaultVisible: boolean
  sortId?: ProductsSortColumn
}[] = [
  { id: 'paretoGrade', label: 'Pareto Grade', defaultVisible: true, sortId: 'pareto_grade' },
  { id: 'cm1', label: 'CM1', defaultVisible: true, sortId: 'cm1' },
  { id: 'cm1_pct', label: 'CM1%', defaultVisible: true, sortId: 'cm1_pct' },
  { id: 'cm1_total', label: 'CM1 Total', defaultVisible: false, sortId: 'cm1_total' },
  { id: 'sales', label: 'Sales', defaultVisible: true, sortId: 'sales' },
  { id: 'refunds', label: 'Refunds', defaultVisible: true, sortId: 'refunds' },
  { id: 'revenue', label: 'Revenue', defaultVisible: true, sortId: 'revenue' },
  { id: 'sold', label: 'Sold', defaultVisible: true, sortId: 'sold' },
  { id: 'refunded', label: 'Refunded', defaultVisible: true, sortId: 'refunded' },
  { id: 'net_quantity', label: 'Net Quantity', defaultVisible: true, sortId: 'net_quantity' },
  { id: 'return_rate', label: 'Return Rate', defaultVisible: true, sortId: 'return_rate' },
  { id: 'nc_return_rate', label: 'NC Return Rate', defaultVisible: false, sortId: 'nc_return_rate' },
  { id: 'ec_return_rate', label: 'EC Return Rate', defaultVisible: false, sortId: 'ec_return_rate' },
  { id: 'orders', label: 'Orders', defaultVisible: true, sortId: 'orders' },
  { id: 'nc_orders', label: 'NC Orders', defaultVisible: false, sortId: 'nc_orders' },
  { id: 'ec_orders', label: 'EC Orders', defaultVisible: false, sortId: 'ec_orders' },
  { id: 'aov', label: 'AOV', defaultVisible: true, sortId: 'aov' },
  { id: 'nc_aov', label: 'NC AOV', defaultVisible: false, sortId: 'nc_aov' },
  { id: 'ec_aov', label: 'EC AOV', defaultVisible: false, sortId: 'ec_aov' },
]

const DEFAULT_VISIBILITY: Record<string, boolean> = {}
COLUMN_CONFIG.forEach((c) => {
  DEFAULT_VISIBILITY[c.id] = c.defaultVisible
})

/** Products page only: ISO currency from API + Intl (avoids shared formatCurrency INR vs $ shortcut). */
function formatProductsCurrency(
  value: number,
  currencyCode: string,
  options?: Intl.NumberFormatOptions
): string {
  const currency = currencyCode?.trim() || 'INR'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(value)
}

const PARETO_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0',
  B: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0',
  C: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-0',
  F: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0',
}

interface ProductsContentProps {
  workspaceSlug: string
  workspaceName: string
}

export function ProductsContent({ workspaceSlug, workspaceName }: ProductsContentProps) {
  const [from, setFrom] = useState(() => format(subDays(new Date(), 364), 'yyyy-MM-dd'))
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const insightProps = usePageInsights(workspaceSlug, 'products', from, to)
  const [groupBy, setGroupBy] = useState<ProductsGroupBy>('product')
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(DEFAULT_VISIBILITY)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [sort, setSort] = useState<ProductsSortColumn>('cm1')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [data, setData] = useState<{ rows: ProductsRow[]; totalRows: number; currency: string }>({
    rows: [],
    totalRows: 0,
    currency: 'INR',
  })
  const [loading, setLoading] = useState(() => !!workspaceSlug && !!from && !!to)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!workspaceSlug || !from || !to) return
    const params = new URLSearchParams({
      from,
      to,
      groupBy,
      sort,
      dir,
      page: String(page),
      pageSize: String(pageSize),
    })
    if (searchDebounced.trim()) params.set('search', searchDebounced.trim())
    fetch(`/api/workspaces/${workspaceSlug}/products?${params}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error)
          setData({ rows: [], totalRows: 0, currency: 'INR' })
        } else {
          setData({
            rows: json.rows ?? [],
            totalRows: json.totalRows ?? 0,
            currency: json.currency ?? 'INR',
          })
        }
      })
      .catch(() => {
        setError('Failed to load products data')
        setData({ rows: [], totalRows: 0, currency: 'INR' })
      })
      .finally(() => setLoading(false))
  }, [workspaceSlug, from, to, groupBy, sort, dir, page, pageSize, searchDebounced])

  const groupLabel = GROUP_BY_OPTIONS.find((g) => g.value === groupBy)?.label ?? 'Product'
  const searchPlaceholder = GROUP_BY_OPTIONS.find((g) => g.value === groupBy)?.searchPlaceholder ?? 'Search products'
  const totalPages = Math.max(1, Math.ceil(data.totalRows / pageSize))

  const visibleColumns = useMemo(
    () => COLUMN_CONFIG.filter((c) => columnVisibility[c.id]),
    [columnVisibility]
  )

  const toggleSort = useCallback((colSortId: ProductsSortColumn) => {
    setSort(colSortId)
    setDir((d) => (sort === colSortId && d === 'desc' ? 'asc' : 'desc'))
    setPage(1)
    setLoading(true)
    setError(null)
  }, [sort])

  const applyYtd = useCallback(() => {
    const now = new Date()
    setFrom(format(startOfYear(now), 'yyyy-MM-dd'))
    setTo(format(endOfDay(now), 'yyyy-MM-dd'))
    setPage(1)
    setLoading(true)
    setError(null)
  }, [])

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconShoppingBag className="h-6 w-6 text-[#96bf48]" />
            Products
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{workspaceName}</p>
        </div>
        <InsightSheet
          page="products"
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
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-4 border-b px-6 py-4">
          <DateRangeFilter
            from={from}
            to={to}
            onFromChange={(v) => { setFrom(v); setPage(1) }}
            onToChange={(v) => { setTo(v); setPage(1) }}
            fromId="products-from"
            toId="products-to"
          />
          <Button variant="outline" size="sm" className="h-8" onClick={applyYtd}>
            Year to date
          </Button>

          <div className="flex items-center gap-2 ml-auto">
            <Select
              value={groupBy}
              onValueChange={(v) => { setGroupBy(v as ProductsGroupBy); setPage(1) }}
            >
              <SelectTrigger className="w-[160px] h-8">
                <SelectValue placeholder="Group by" />
              </SelectTrigger>
              <SelectContent>
                {GROUP_BY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <IconLayoutColumns className="mr-1.5 h-4 w-4" />
                  Columns
                  <IconChevronDown className="ml-1.5 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-[70vh] overflow-y-auto">
                {COLUMN_CONFIG.map((c) => (
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
            <Button variant="outline" size="sm" className="h-8" title="Filters (settings)">
              <IconFilter className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="px-6 py-3 border-b">
          <Input
            placeholder={searchPlaceholder}
            className="max-w-xs"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </div>

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
                    <TableHead className="min-w-[220px] w-[280px] whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {groupLabel}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => toggleSort('label')}
                        >
                          {sort === 'label' ? (
                            dir === 'desc' ? (
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
                    {visibleColumns.map((c) => (
                      <TableHead key={c.id} className="whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          {c.label}
                          {c.sortId != null && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              onClick={() => toggleSort(c.sortId!)}
                            >
                              {sort === c.sortId ? (
                                dir === 'desc' ? (
                                  <IconArrowDown className="size-3.5" />
                                ) : (
                                  <IconArrowUp className="size-3.5" />
                                )
                              ) : (
                                <IconArrowsSort className="size-3.5 text-muted-foreground" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={visibleColumns.length + 1}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No data for the selected filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((row, idx) => (
                      <TableRow key={`${row.label}-${idx}`}>
                        <TableCell className="min-w-[220px] max-w-[360px] font-medium align-top">
                          <span className="break-words" title={row.label}>
                            {row.label}
                          </span>
                        </TableCell>
                        {visibleColumns.map((col) => {
                          if (col.id === 'paretoGrade') {
                            return (
                              <TableCell key={col.id} className="text-right align-top">
                                <Badge
                                  variant="outline"
                                  className={PARETO_COLORS[row.paretoGrade] ?? ''}
                                >
                                  {row.paretoGrade}
                                </Badge>
                              </TableCell>
                            )
                          }
                          if (col.id === 'cm1' || col.id === 'sales' || col.id === 'refunds' || col.id === 'revenue' || col.id === 'aov' || col.id === 'nc_aov' || col.id === 'ec_aov') {
                            const val =
                              col.id === 'nc_aov'
                                ? row.ncAov
                                : col.id === 'ec_aov'
                                  ? row.ecAov
                                  : (row[col.id as keyof ProductsRow] as number)
                            return (
                              <TableCell key={col.id} className="text-right tabular-nums align-top">
                                {formatProductsCurrency(val, data.currency)}
                              </TableCell>
                            )
                          }
                          if (col.id === 'cm1_pct' || col.id === 'cm1_total' || col.id === 'return_rate' || col.id === 'nc_return_rate' || col.id === 'ec_return_rate') {
                            const val =
                              col.id === 'cm1_pct'
                                ? row.cm1Pct
                                : col.id === 'cm1_total'
                                  ? row.cm1Total
                                  : col.id === 'return_rate'
                                    ? row.returnRate
                                    : col.id === 'nc_return_rate'
                                      ? row.ncReturnRate
                                      : row.ecReturnRate
                            return (
                              <TableCell key={col.id} className="text-right tabular-nums align-top">
                                {typeof val === 'number' ? `${Number(val).toFixed(2)}%` : '—'}
                              </TableCell>
                            )
                          }
                          if (col.id === 'sold' || col.id === 'refunded' || col.id === 'net_quantity') {
                            const val =
                              col.id === 'net_quantity'
                                ? row.netQuantity
                                : (row[col.id as keyof ProductsRow] as number)
                            return (
                              <TableCell key={col.id} className="text-right tabular-nums align-top">
                                {typeof val === 'number' ? Math.round(val).toLocaleString() : '—'}
                              </TableCell>
                            )
                          }
                          if (col.id === 'orders' || col.id === 'nc_orders' || col.id === 'ec_orders') {
                            const val =
                              col.id === 'nc_orders'
                                ? row.ncOrders
                                : col.id === 'ec_orders'
                                  ? row.ecOrders
                                  : (row.orders as number)
                            return (
                              <TableCell key={col.id} className="text-right tabular-nums align-top">
                                {typeof val === 'number' ? val.toLocaleString() : '—'}
                              </TableCell>
                            )
                          }
                          return (
                            <TableCell key={col.id} className="text-right tabular-nums align-top">
                              {String((row as unknown as Record<string, unknown>)[col.id] ?? '—')}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between px-6 py-3 border-t">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Rows per page</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v))
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className="w-16 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 12, 20, 30, 50].map((n) => (
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
                    disabled={page <= 1}
                    onClick={() => setPage(1)}
                  >
                    «
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ‹
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    ›
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={page >= totalPages}
                    onClick={() => setPage(totalPages)}
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
