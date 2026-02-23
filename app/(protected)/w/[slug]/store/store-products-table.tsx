'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
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
} from '@tabler/icons-react'
import { format } from 'date-fns'

import { useWorkspace } from '@/hooks/use-workspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

export type ProductRow = {
  id: string
  title: string
  handle: string
  vendor: string | null
  productType: string | null
  status: string
  imageUrl: string | null
  totalInventory: number | null
  publishedAt: string | null
  createdAt: string
}

type ProductsResponse = {
  data: ProductRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ARCHIVED', label: 'Archived' },
]

function useProductsParams() {
  const searchParams = useSearchParams()
  const page = Number(searchParams.get('page')) || 1
  const pageSize = Number(searchParams.get('pageSize')) || 10
  const sort = searchParams.get('sort') || 'title'
  const order = (searchParams.get('order') || 'asc') as 'asc' | 'desc'
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || ''
  return { page, pageSize, sort, order, search, status }
}

export function StoreProductsTable() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { current } = useWorkspace()
  const slug = current.slug
  const params = useProductsParams()
  const [searchInput, setSearchInput] = useState(params.search)
  useEffect(() => {
    setSearchInput(params.search)
  }, [params.search])

  const updateParam = useCallback(
    (key: string, value: string | number) => {
      const next = new URLSearchParams(searchParams.toString())
      if (value === '' || (key === 'page' && value === 1)) next.delete(key)
      else next.set(key, String(value))
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

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

  const { data, isLoading, isError, error } = useQuery<ProductsResponse>({
    queryKey: ['store', 'products', slug, params],
    queryFn: async () => {
      const q = new URLSearchParams()
      q.set('page', String(params.page))
      q.set('pageSize', String(params.pageSize))
      q.set('sort', params.sort)
      q.set('order', params.order)
      if (params.search) q.set('search', params.search)
      if (params.status) q.set('status', params.status)
      const res = await fetch(`/api/workspaces/${slug}/store/products?${q.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load products')
      }
      return res.json()
    },
  })

  const columns = useMemo<ColumnDef<ProductRow>[]>(
    () => [
      {
        accessorKey: 'imageUrl',
        header: 'Product',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <div className="relative size-10 shrink-0 overflow-hidden rounded border bg-muted">
              {row.original.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.original.imageUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground text-xs">
                  —
                </div>
              )}
            </div>
            <div>
              <div className="font-medium">{row.original.title}</div>
              <div className="text-muted-foreground text-xs">{row.original.handle}</div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'productType',
        header: 'Type',
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.productType || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'vendor',
        header: 'Vendor',
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.vendor || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant="outline" className="capitalize">
            {row.original.status?.toLowerCase() ?? '—'}
          </Badge>
        ),
      },
      {
        accessorKey: 'totalInventory',
        header: () => <div className="text-right">Inventory</div>,
        cell: ({ row }) => (
          <div className="text-right">
            {row.original.totalInventory != null ? row.original.totalInventory : '—'}
          </div>
        ),
      },
      {
        accessorKey: 'publishedAt',
        header: 'Published',
        cell: ({ row }) => (
          <span className="text-muted-foreground whitespace-nowrap">
            {row.original.publishedAt
              ? format(new Date(row.original.publishedAt), 'MMM d, yyyy')
              : '—'}
          </span>
        ),
      },
    ],
    []
  )

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: data?.totalPages ?? 0,
    manualSorting: true,
    getRowId: (row) => row.id,
  })

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-destructive">
        {error instanceof Error ? error.message : 'Failed to load products'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search products, handle, vendor..."
          className="max-w-xs"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              updateParams({ search: searchInput.trim(), page: 1 })
            }
          }}
        />
        <Select
          value={params.status || '__all__'}
          onValueChange={(v) =>
            updateParams({ status: v === '__all__' ? '' : v, page: 1 })
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value || '__all__'} value={o.value || '__all__'}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-[400px] rounded-lg border bg-card">
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
                      const apiSortField =
                        colId === 'imageUrl' ? 'title' : colId
                      const canSort = [
                        'title',
                        'productType',
                        'status',
                        'totalInventory',
                        'publishedAt',
                        'createdAt',
                      ].includes(apiSortField)
                      const isSorted = params.sort === apiSortField
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
                                className="size-6"
                                onClick={() =>
                                  updateParams({
                                    sort: apiSortField,
                                    order:
                                      isSorted && params.order === 'desc'
                                        ? 'asc'
                                        : 'desc',
                                    page: 1,
                                  })
                                }
                              >
                                {isSorted ? (
                                  params.order === 'desc' ? (
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
                      No products found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {data && data.totalPages > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t px-4 py-3">
                <p className="text-muted-foreground text-sm">
                  {data.total} product{data.total !== 1 ? 's' : ''}
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
                      {[10, 20, 30, 50].map((n) => (
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
