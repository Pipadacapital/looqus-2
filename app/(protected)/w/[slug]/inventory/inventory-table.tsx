'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
    type ColumnDef,
    type VisibilityState,
} from '@tanstack/react-table'
import {
    IconChevronLeft,
    IconChevronRight,
    IconChevronsLeft,
    IconChevronsRight,
    IconLoader2,
    IconArrowsSort,
    IconArrowUp,
    IconArrowDown,
    IconArrowLeft,
} from '@tabler/icons-react'
import { format } from 'date-fns'

import { useWorkspace } from '@/hooks/use-workspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { InventoryStatus } from '@/lib/inventory-constants'

// ────────────────────────────── Types ─────────────────────────────

type InventoryRow = {
    id: string
    shopifyId: string
    title: string
    brand: string
    skus: string
    status: InventoryStatus
    quantity: number
    costValue: number
    price: number | null
    compareAtPrice: number | null
    sellThrough: number
    qtyL30: number
    qtyL90: number
    qtyL180: number
    qtyL360: number
    qtyN14ly: number
    daysLeft: number
    leadTimeDays: number
    tags: string
}

type InventoryResponse = {
    data: InventoryRow[]
    total: number
    page: number
    pageSize: number
    totalPages: number
    productTitle?: string // set when in variant view
}

// ────────────────────────── Status badge ──────────────────────────

const STATUS_COLORS: Record<InventoryStatus, string> = {
    'Severely Overstocked': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    'Overstocked': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    'Healthy': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    'Out of stock': 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

function StatusBadge({ status }: { status: InventoryStatus }) {
    return (
        <Badge
            variant="outline"
            className={`border-0 text-xs font-medium ${STATUS_COLORS[status] ?? ''}`}
        >
            {status}
        </Badge>
    )
}

// ───────────────── Inline lead time editor ────────────────────────

function LeadTimeCell({
    value,
    shopifyId,
    slug,
    canEdit,
}: {
    value: number
    shopifyId: string
    slug: string
    canEdit: boolean
}) {
    const [editing, setEditing] = useState(false)
    const [localVal, setLocalVal] = useState(String(value))
    const queryClient = useQueryClient()

    useEffect(() => {
        setLocalVal(String(value))
    }, [value])

    const mutation = useMutation({
        mutationFn: async (days: number) => {
            const res = await fetch(`/api/workspaces/${slug}/inventory/lead-time`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productShopifyId: shopifyId, leadTimeDays: days }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.error || 'Failed to update lead time')
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory'] })
        },
    })

    const save = () => {
        const num = Math.max(0, Math.round(Number(localVal) || 0))
        if (num !== value) {
            mutation.mutate(num)
        }
        setEditing(false)
    }

    if (!canEdit) {
        return <span className="text-muted-foreground">{value}</span>
    }

    if (editing) {
        return (
            <Input
                type="number"
                min={0}
                className="h-7 w-16 text-right"
                value={localVal}
                autoFocus
                onChange={(e) => setLocalVal(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') save()
                    if (e.key === 'Escape') {
                        setLocalVal(String(value))
                        setEditing(false)
                    }
                }}
            />
        )
    }

    return (
        <button
            onClick={() => setEditing(true)}
            className="cursor-pointer text-left hover:underline text-muted-foreground"
        >
            {value}
            <span className="ml-1 text-xs opacity-50">✏️</span>
        </button>
    )
}

// ─────────────────────── Params helper ────────────────────────────

function useInventoryParams() {
    const searchParams = useSearchParams()
    const page = Number(searchParams.get('page')) || 1
    const pageSize = Number(searchParams.get('pageSize')) || 20
    const sort = searchParams.get('sort') || 'title'
    const dir = (searchParams.get('dir') || 'asc') as 'asc' | 'desc'
    const search = searchParams.get('search') || ''
    const asOf =
        searchParams.get('asOf') || format(new Date(), 'yyyy-MM-dd')
    const productId = searchParams.get('productId') || ''
    return { page, pageSize, sort, dir, search, asOf, productId }
}

// ─────────────────────── Column visibility key ───────────────────

function getVisibilityKey(slug: string) {
    return `inventory-column-visibility-${slug}`
}

function loadSavedVisibility(slug: string): VisibilityState {
    if (typeof window === 'undefined') return {}
    try {
        const raw = localStorage.getItem(getVisibilityKey(slug))
        return raw ? JSON.parse(raw) : {}
    } catch {
        return {}
    }
}

function saveVisibility(slug: string, vis: VisibilityState) {
    try {
        localStorage.setItem(getVisibilityKey(slug), JSON.stringify(vis))
    } catch {
        // ignore storage errors
    }
}

// ─────────────────────── Main Component ──────────────────────────

export function InventoryTable() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const { current, role } = useWorkspace()
    const slug = current.slug
    const params = useInventoryParams()
    const [searchInput, setSearchInput] = useState(params.search)
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
        () => loadSavedVisibility(slug)
    )

    const isOwner = role === 'OWNER'
    const canBackfill = role === 'OWNER' || role === 'ADMIN'
    const isVariantView = !!params.productId

    useEffect(() => {
        setSearchInput(params.search)
    }, [params.search])

    // Save column visibility to localStorage
    useEffect(() => {
        saveVisibility(slug, columnVisibility)
    }, [slug, columnVisibility])

    const updateParams = useCallback(
        (updates: Record<string, string | number>) => {
            const next = new URLSearchParams(searchParams.toString())
            for (const [key, value] of Object.entries(updates)) {
                if (value === '' || (key === 'page' && value === 1)) next.delete(key)
                else next.set(key, String(value))
            }
            router.replace(`${pathname}?${next.toString()}`, { scroll: false })
        },
        [pathname, router, searchParams]
    )

    const updateParam = useCallback(
        (key: string, value: string | number) => {
            updateParams({ [key]: value })
        },
        [updateParams]
    )

    const goToVariantView = useCallback(
        (productId: string) => {
            const next = new URLSearchParams()
            if (params.asOf !== format(new Date(), 'yyyy-MM-dd')) {
                next.set('asOf', params.asOf)
            }
            next.set('productId', productId)
            router.push(`${pathname}?${next.toString()}`)
        },
        [pathname, router, params.asOf]
    )

    const goBackToProducts = useCallback(() => {
        const next = new URLSearchParams()
        if (params.asOf !== format(new Date(), 'yyyy-MM-dd')) {
            next.set('asOf', params.asOf)
        }
        router.push(`${pathname}?${next.toString()}`)
    }, [pathname, router, params.asOf])

    const queryClient = useQueryClient()
    const backfillMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch(
                `/api/workspaces/${slug}/shopify/backfill-orders?daysBack=400`,
                { method: 'POST' }
            )
            if (!res.ok) {
                const j = await res.json().catch(() => ({}))
                throw new Error(j.error || 'Backfill failed')
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory', slug] })
        },
    })

    const { data, isLoading, isError, error } = useQuery<InventoryResponse>({
        queryKey: ['inventory', slug, params],
        queryFn: async () => {
            const q = new URLSearchParams()
            q.set('page', String(params.page))
            q.set('pageSize', String(params.pageSize))
            q.set('sort', params.sort)
            q.set('dir', params.dir)
            q.set('asOf', params.asOf)
            if (params.search) q.set('search', params.search)
            if (params.productId) q.set('productId', params.productId)
            const res = await fetch(
                `/api/workspaces/${slug}/inventory?${q.toString()}`
            )
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.error || 'Failed to load inventory')
            }
            return res.json()
        },
    })

    // ───── Column definitions ─────

    const columns = useMemo<ColumnDef<InventoryRow>[]>(
        () => [
            {
                accessorKey: 'title',
                header: isVariantView ? 'Variant' : 'Product',
                cell: ({ row }) =>
                    isVariantView ? (
                        <div className="max-w-[220px] truncate font-medium" title={row.original.title}>
                            {row.original.title}
                        </div>
                    ) : (
                        <button
                            onClick={() => goToVariantView(row.original.id)}
                            className="max-w-[220px] truncate font-medium text-left cursor-pointer hover:underline text-primary"
                            title={row.original.title}
                        >
                            {row.original.title}
                        </button>
                    ),
                enableHiding: false,
            },
            {
                accessorKey: 'brand',
                header: 'Brand',
                cell: ({ row }) => (
                    <span className="text-muted-foreground whitespace-nowrap">
                        {row.original.brand}
                    </span>
                ),
            },
            {
                accessorKey: 'skus',
                header: 'SKU',
                cell: ({ row }) => (
                    <span
                        className="text-muted-foreground max-w-[150px] truncate inline-block"
                        title={row.original.skus}
                    >
                        {row.original.skus}
                    </span>
                ),
            },
            {
                id: 'leadTimeDays',
                accessorKey: 'leadTimeDays',
                header: 'Lead Time',
                cell: ({ row }) => (
                    <LeadTimeCell
                        value={row.original.leadTimeDays}
                        shopifyId={row.original.shopifyId}
                        slug={slug}
                        canEdit={isOwner}
                    />
                ),
            },
            {
                id: 'status',
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <StatusBadge status={row.original.status} />,
            },
            {
                accessorKey: 'quantity',
                header: () => <div className="text-right">Quantity</div>,
                cell: ({ row }) => (
                    <div className="text-right font-medium tabular-nums">
                        {row.original.quantity.toLocaleString()}
                    </div>
                ),
            },
            {
                accessorKey: 'costValue',
                header: () => <div className="text-right">Cost Value</div>,
                cell: ({ row }) => (
                    <div className="text-right text-muted-foreground tabular-nums">
                        {row.original.costValue > 0
                            ? `₹${row.original.costValue.toLocaleString()}`
                            : '₹0'}
                    </div>
                ),
            },
            {
                accessorKey: 'price',
                header: () => <div className="text-right">Price</div>,
                cell: ({ row }) => (
                    <div className="text-right text-muted-foreground tabular-nums">
                        {row.original.price != null
                            ? `₹${Number(row.original.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                    </div>
                ),
            },
            {
                accessorKey: 'compareAtPrice',
                header: () => <div className="text-right">Compare at Price</div>,
                cell: ({ row }) => (
                    <div className="text-right text-muted-foreground tabular-nums">
                        {row.original.compareAtPrice != null
                            ? `₹${Number(row.original.compareAtPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                    </div>
                ),
            },
            {
                accessorKey: 'sellThrough',
                header: () => <div className="text-right">Sell-Through %</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums">
                        {row.original.sellThrough.toFixed(1)}%
                    </div>
                ),
            },
            {
                accessorKey: 'qtyL30',
                header: () => <div className="text-right">Qty (L30)</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums">{row.original.qtyL30}</div>
                ),
            },
            {
                accessorKey: 'qtyL90',
                header: () => <div className="text-right">Qty (L90)</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums">{row.original.qtyL90}</div>
                ),
            },
            {
                accessorKey: 'qtyL180',
                header: () => <div className="text-right">Qty (L180)</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums">{row.original.qtyL180}</div>
                ),
            },
            {
                accessorKey: 'qtyL360',
                header: () => <div className="text-right">Qty (L360)</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums">{row.original.qtyL360}</div>
                ),
            },
            {
                accessorKey: 'qtyN14ly',
                header: () => <div className="text-right">Qty (N14LY)</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums">{row.original.qtyN14ly}</div>
                ),
            },
            {
                accessorKey: 'daysLeft',
                header: () => <div className="text-right">Days Left of Stock</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums">
                        {row.original.daysLeft >= 999999 ? '∞' : row.original.daysLeft.toLocaleString()}
                    </div>
                ),
            },
            {
                accessorKey: 'tags',
                header: 'Tags',
                cell: ({ row }) => (
                    <span
                        className="text-muted-foreground max-w-[150px] truncate inline-block text-xs"
                        title={row.original.tags}
                    >
                        {row.original.tags}
                    </span>
                ),
            },
        ],
        [slug, isOwner, isVariantView, goToVariantView]
    )

    // ────── TanStack Table ──────

    // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table API is not memoization-safe
    const table = useReactTable({
        data: data?.data ?? [],
        columns,
        getCoreRowModel: getCoreRowModel(),
        manualPagination: true,
        pageCount: data?.totalPages ?? 0,
        manualSorting: true,
        getRowId: (row) => row.id,
        state: { columnVisibility },
        onColumnVisibilityChange: setColumnVisibility,
    })

    // ─── Sortable columns ───

    const sortableColumns = [
        'title', 'vendor', 'quantity', 'qtyL30', 'qtyL90',
        'qtyL180', 'qtyL360', 'qtyN14ly', 'compareAtPrice', 'costValue',
        'price', 'sellThrough', 'daysLeft',
    ]

    // ─── Render ───

    if (isError) {
        return (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-destructive">
                {error instanceof Error ? error.message : 'Failed to load inventory'}
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* ── Back button for variant view ── */}
            {isVariantView && (
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={goBackToProducts}
                        className="gap-1.5"
                    >
                        <IconArrowLeft className="size-4" />
                        Back to all products
                    </Button>
                    {data?.productTitle && (
                        <span className="text-muted-foreground text-sm">
                            Variants of <strong>{data.productTitle}</strong>
                        </span>
                    )}
                </div>
            )}

            {/* ── Toolbar ── */}
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    placeholder={isVariantView ? 'Search by variant or SKU…' : 'Search by name or SKU…'}
                    className="max-w-xs"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            updateParams({ search: searchInput.trim(), page: 1 })
                        }
                    }}
                />

                {/* As-of date picker */}
                <div className="flex items-center gap-2">
                    <Label htmlFor="inv-asof" className="text-xs whitespace-nowrap">
                        As of
                    </Label>
                    <Input
                        id="inv-asof"
                        type="date"
                        value={params.asOf}
                        onChange={(e) =>
                            updateParams({ asOf: e.target.value, page: 1 })
                        }
                        className="w-[150px]"
                    />
                </div>

                {canBackfill && (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={backfillMutation.isPending}
                        onClick={() => backfillMutation.mutate()}
                        title="Fetch up to 400 days of orders from Shopify (run once to fix L90/L180/L360)"
                    >
                        {backfillMutation.isPending ? (
                            <IconLoader2 className="size-4 animate-spin" />
                        ) : (
                            'Backfill orders'
                        )}
                    </Button>
                )}

                <div className="ml-auto flex items-center gap-2">
                    {/* Columns dropdown */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                Columns
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                            {table
                                .getAllColumns()
                                .filter((col) => col.getCanHide())
                                .map((col) => (
                                    <DropdownMenuCheckboxItem
                                        key={col.id}
                                        checked={col.getIsVisible()}
                                        onCheckedChange={(v) => col.toggleVisibility(!!v)}
                                        className="capitalize"
                                    >
                                        {typeof col.columnDef.header === 'string'
                                            ? col.columnDef.header
                                            : col.id}
                                    </DropdownMenuCheckboxItem>
                                ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* ── Table ── */}
            <div className="min-h-[400px] rounded-lg border bg-card overflow-x-auto">
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
                                            const colId = header.column.id
                                            const canSort = sortableColumns.includes(colId)
                                            const isSorted = params.sort === colId
                                            return (
                                                <TableHead key={header.id} className="whitespace-nowrap">
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
                                                                className="size-6"
                                                                onClick={() =>
                                                                    updateParams({
                                                                        sort: colId,
                                                                        dir:
                                                                            isSorted && params.dir === 'desc'
                                                                                ? 'asc'
                                                                                : 'desc',
                                                                        page: 1,
                                                                    })
                                                                }
                                                            >
                                                                {isSorted ? (
                                                                    params.dir === 'desc' ? (
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
                                            {isVariantView ? 'No variants found.' : 'No products found.'}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>

                        {/* ── Pagination ── */}
                        {data && data.totalPages > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-4 border-t px-4 py-3">
                                <p className="text-muted-foreground text-sm">
                                    {data.total} {isVariantView ? 'variant' : 'product'}{data.total !== 1 ? 's' : ''}
                                </p>
                                <div className="flex items-center gap-2">
                                    <Select
                                        value={String(params.pageSize)}
                                        onValueChange={(v) =>
                                            updateParams({ pageSize: v, page: 1 })
                                        }
                                    >
                                        <SelectTrigger className="w-20" size="sm">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {[20, 50, 100].map((n) => (
                                                <SelectItem key={n} value={String(n)}>
                                                    {n}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <span className="text-muted-foreground text-sm">
                                        Page {params.page} of {data.totalPages}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-8"
                                        disabled={params.page <= 1}
                                        onClick={() => updateParam('page', 1)}
                                    >
                                        <IconChevronsLeft className="size-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-8"
                                        disabled={params.page <= 1}
                                        onClick={() =>
                                            updateParam('page', Math.max(1, params.page - 1))
                                        }
                                    >
                                        <IconChevronLeft className="size-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-8"
                                        disabled={params.page >= data.totalPages}
                                        onClick={() =>
                                            updateParam(
                                                'page',
                                                Math.min(data.totalPages, params.page + 1)
                                            )
                                        }
                                    >
                                        <IconChevronRight className="size-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-8"
                                        disabled={params.page >= data.totalPages}
                                        onClick={() => updateParam('page', data.totalPages)}
                                    >
                                        <IconChevronsRight className="size-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
