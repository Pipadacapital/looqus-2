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

export type CustomerRow = {
  id: string
  email: string | null
  firstName: string | null
  lastName: string | null
  ordersCount: number
  totalSpent: string
  currency: string | null
  state: string | null
  shopifyCreatedAt: string | null
  createdAt: string
}

type CustomersResponse = {
  data: CustomerRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function useCustomersParams() {
  const searchParams = useSearchParams()
  const page = Number(searchParams.get('page')) || 1
  const pageSize = Number(searchParams.get('pageSize')) || 10
  const sort = searchParams.get('sort') || 'firstName'
  const order = (searchParams.get('order') || 'asc') as 'asc' | 'desc'
  const search = searchParams.get('search') || ''
  return { page, pageSize, sort, order, search }
}

function displayName(row: CustomerRow): string {
  const first = row.firstName?.trim()
  const last = row.lastName?.trim()
  if (first || last) return [first, last].filter(Boolean).join(' ')
  return row.email || '—'
}

export function StoreCustomersTable() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { current } = useWorkspace()
  const slug = current.slug
  const params = useCustomersParams()
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

  const { data, isLoading, isError, error } = useQuery<CustomersResponse>({
    queryKey: ['store', 'customers', slug, params],
    queryFn: async () => {
      const q = new URLSearchParams()
      q.set('page', String(params.page))
      q.set('pageSize', String(params.pageSize))
      q.set('sort', params.sort)
      q.set('order', params.order)
      if (params.search) q.set('search', params.search)
      const res = await fetch(`/api/workspaces/${slug}/store/customers?${q.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load customers')
      }
      return res.json()
    },
  })

  const columns = useMemo<ColumnDef<CustomerRow>[]>(
    () => [
      {
        accessorKey: 'firstName',
        header: 'Customer',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{displayName(row.original)}</div>
            {row.original.email && (
              <div className="text-muted-foreground text-xs">
                {row.original.email}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.email || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'ordersCount',
        header: () => <div className="text-right">Orders</div>,
        cell: ({ row }) => (
          <div className="text-right">{row.original.ordersCount}</div>
        ),
      },
      {
        accessorKey: 'totalSpent',
        header: () => <div className="text-right">Total spent</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium">
            {row.original.currency || ''} {Number(row.original.totalSpent).toFixed(2)}
          </div>
        ),
      },
      {
        accessorKey: 'state',
        header: 'State',
        cell: ({ row }) => (
          <span className="text-muted-foreground capitalize">
            {row.original.state || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'shopifyCreatedAt',
        header: 'Created',
        cell: ({ row }) => (
          <span className="text-muted-foreground whitespace-nowrap">
            {row.original.shopifyCreatedAt
              ? format(new Date(row.original.shopifyCreatedAt), 'MMM d, yyyy')
              : '—'}
          </span>
        ),
      },
    ],
    []
  )

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table API is not memoization-safe
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
        {error instanceof Error ? error.message : 'Failed to load customers'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by name or email..."
          className="max-w-xs"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              updateParams({ search: searchInput.trim(), page: 1 })
            }
          }}
        />
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
                        colId === 'firstName' ? 'firstName' : colId
                      const canSort = [
                        'firstName',
                        'email',
                        'ordersCount',
                        'totalSpent',
                        'shopifyCreatedAt',
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
                      No customers found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {data && data.totalPages > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t px-4 py-3">
                <p className="text-muted-foreground text-sm">
                  {data.total} customer{data.total !== 1 ? 's' : ''}
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
