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

export type OrderRow = {
  id: string
  orderNumber: string
  name: string
  email: string | null
  totalPrice: string
  currency: string
  financialStatus: string
  fulfillmentStatus: string | null
  processedAt: string
  cancelledAt: string | null
}

type OrdersResponse = {
  data: OrderRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const FINANCIAL_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'PAID', label: 'Paid' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' },
]

const FULFILLMENT_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'FULFILLED', label: 'Fulfilled' },
  { value: 'UNFULFILLED', label: 'Unfulfilled' },
  { value: 'PARTIALLY_FULFILLED', label: 'Partially fulfilled' },
]

function useOrdersParams() {
  const searchParams = useSearchParams()
  const page = Number(searchParams.get('page')) || 1
  const pageSize = Number(searchParams.get('pageSize')) || 10
  const sort = searchParams.get('sort') || 'processedAt'
  const order = (searchParams.get('order') || 'desc') as 'asc' | 'desc'
  const search = searchParams.get('search') || ''
  const financialStatus = searchParams.get('financialStatus') || ''
  const fulfillmentStatus = searchParams.get('fulfillmentStatus') || ''
  return {
    page,
    pageSize,
    sort,
    order,
    search,
    financialStatus,
    fulfillmentStatus,
  }
}

export function StoreOrdersTable() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { current } = useWorkspace()
  const slug = current.slug
  const params = useOrdersParams()
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

  const { data, isLoading, isError, error } = useQuery<OrdersResponse>({
    queryKey: ['store', 'orders', slug, params],
    queryFn: async () => {
      const q = new URLSearchParams()
      q.set('page', String(params.page))
      q.set('pageSize', String(params.pageSize))
      q.set('sort', params.sort)
      q.set('order', params.order)
      if (params.search) q.set('search', params.search)
      if (params.financialStatus) q.set('financialStatus', params.financialStatus)
      if (params.fulfillmentStatus) q.set('fulfillmentStatus', params.fulfillmentStatus)
      const res = await fetch(`/api/workspaces/${slug}/store/orders?${q.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load orders')
      }
      return res.json()
    },
  })

  const columns = useMemo<ColumnDef<OrderRow>[]>(
    () => [
      {
        accessorKey: 'orderNumber',
        header: 'Order',
        cell: ({ row }) => (
          <div className="font-medium">{row.original.name}</div>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Customer',
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.email || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'totalPrice',
        header: () => <div className="text-right">Total</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium">
            {row.original.currency} {Number(row.original.totalPrice).toFixed(2)}
          </div>
        ),
      },
      {
        accessorKey: 'financialStatus',
        header: 'Payment',
        cell: ({ row }) => (
          <Badge variant="outline" className="capitalize">
            {row.original.financialStatus?.replace(/_/g, ' ') ?? '—'}
          </Badge>
        ),
      },
      {
        accessorKey: 'fulfillmentStatus',
        header: 'Fulfillment',
        cell: ({ row }) => (
          <Badge variant="secondary" className="capitalize">
            {row.original.fulfillmentStatus?.replace(/_/g, ' ') ?? '—'}
          </Badge>
        ),
      },
      {
        accessorKey: 'processedAt',
        header: 'Date',
        cell: ({ row }) => (
          <span className="text-muted-foreground whitespace-nowrap">
            {format(new Date(row.original.processedAt), 'MMM d, yyyy')}
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
        {error instanceof Error ? error.message : 'Failed to load orders'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search orders, email..."
          className="max-w-xs"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              updateParam('search', searchInput.trim())
              updateParam('page', 1)
            }
          }}
        />
        <Select
          value={params.financialStatus || '__all__'}
          onValueChange={(v) => {
            updateParam('financialStatus', v === '__all__' ? '' : v)
            updateParam('page', 1)
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Payment" />
          </SelectTrigger>
          <SelectContent>
            {FINANCIAL_OPTIONS.map((o) => (
              <SelectItem key={o.value || '__all__'} value={o.value || '__all__'}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={params.fulfillmentStatus || '__all__'}
          onValueChange={(v) => {
            updateParam('fulfillmentStatus', v === '__all__' ? '' : v)
            updateParam('page', 1)
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Fulfillment" />
          </SelectTrigger>
          <SelectContent>
            {FULFILLMENT_OPTIONS.map((o) => (
              <SelectItem key={o.value || '__all__'} value={o.value || '__all__'}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
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
                        colId === 'orderNumber' ? 'name' : colId
                      const canSort =
                        apiSortField === 'processedAt' ||
                        apiSortField === 'totalPrice' ||
                        apiSortField === 'name'
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
                                onClick={() => {
                                  updateParam('sort', apiSortField)
                                  updateParam(
                                    'order',
                                    isSorted && params.order === 'desc'
                                      ? 'asc'
                                      : 'desc'
                                  )
                                  updateParam('page', 1)
                                }}
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
                      No orders found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {data && data.totalPages > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t px-4 py-3">
                <p className="text-muted-foreground text-sm">
                  {data.total} order{data.total !== 1 ? 's' : ''}
                </p>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(params.pageSize)}
                    onValueChange={(v) => {
                      updateParam('pageSize', v)
                      updateParam('page', 1)
                    }}
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
