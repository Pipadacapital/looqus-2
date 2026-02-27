'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { IconChevronLeft, IconChevronRight, IconLoader2, IconCheck } from '@tabler/icons-react'

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

type ProductRow = {
  id: string
  title: string
  handle: string
  imageUrl: string | null
  coq: number | null
}

type ProductsResponse = {
  data: (ProductRow & {
    vendor: string | null
    productType: string | null
    status: string
    totalInventory: number | null
    publishedAt: string | null
    createdAt: string
  })[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function useCoqsParams() {
  const searchParams = useSearchParams()
  const page = Number(searchParams.get('page')) || 1
  const pageSize = Number(searchParams.get('pageSize')) || 20
  const search = searchParams.get('search') || ''
  const coqFilter = searchParams.get('coqFilter') || ''
  return { page, pageSize, search, coqFilter }
}

export function CoqsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { current } = useWorkspace()
  const slug = current.slug
  const params = useCoqsParams()
  const [searchInput, setSearchInput] = useState(params.search)
  const [localCoq, setLocalCoq] = useState<Record<string, string>>({})

  useEffect(() => {
    setSearchInput(params.search)
  }, [params.search])

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

  const COQ_FILTER_OPTIONS = [
    { value: '', label: 'All products' },
    { value: 'set', label: 'COQ set' },
    { value: 'not_set', label: 'COQ not set' },
  ] as const

  const { data, isLoading, isError, error } = useQuery<ProductsResponse>({
    queryKey: ['store', 'products', 'coqs', slug, params],
    queryFn: async () => {
      const q = new URLSearchParams()
      q.set('page', String(params.page))
      q.set('pageSize', String(params.pageSize))
      q.set('sort', 'title')
      q.set('order', 'asc')
      if (params.search) q.set('search', params.search)
      if (params.coqFilter) q.set('coqFilter', params.coqFilter)
      const res = await fetch(`/api/workspaces/${slug}/store/products?${q.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load products')
      }
      return res.json()
    },
  })

  const patchCoqMutation = useMutation({
    mutationFn: async ({
      productId,
      coq,
    }: {
      productId: string
      coq: number | null
    }) => {
      const res = await fetch(
        `/api/workspaces/${slug}/store/products/${productId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coq }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to update COQ')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store', 'products', 'coqs', slug] })
      queryClient.invalidateQueries({ queryKey: ['store', 'products', slug] })
    },
  })

  const handleSaveCoq = (productId: string) => {
    const raw = localCoq[productId]
    const value =
      raw === undefined || raw === ''
        ? null
        : Number.parseFloat(raw)
    if (value !== null && (Number.isNaN(value) || value < 0)) return
    patchCoqMutation.mutate(
      { productId, coq: value },
      {
        onSuccess: () => {
          setLocalCoq((prev) => {
            const next = { ...prev }
            delete next[productId]
            return next
          })
        },
      }
    )
  }

  const getCoqInputValue = (productId: string, currentCoq: number | null) => {
    if (productId in localCoq) return localCoq[productId]
    return currentCoq != null ? String(currentCoq) : ''
  }

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
          placeholder="Search products..."
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
          value={params.coqFilter || '__all__'}
          onValueChange={(v) =>
            updateParams({ coqFilter: v === '__all__' ? '' : v, page: 1 })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="COQ filter" />
          </SelectTrigger>
          <SelectContent>
            {COQ_FILTER_OPTIONS.map((o) => (
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
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-[180px]">COQ</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.data.length ? (
                  data.data.map((row) => {
                    const inputValue = getCoqInputValue(row.id, row.coq)
                    const isSaving = patchCoqMutation.isPending && patchCoqMutation.variables?.productId === row.id
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="relative size-10 shrink-0 overflow-hidden rounded border bg-muted">
                              {row.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={row.imageUrl}
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
                              <div className="font-medium">{row.title}</div>
                              <div className="text-muted-foreground text-xs">
                                {row.handle}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            placeholder="0"
                            className="w-full"
                            value={inputValue}
                            onChange={(e) =>
                              setLocalCoq((prev) => ({
                                ...prev,
                                [row.id]: e.target.value,
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSaving}
                            onClick={() => handleSaveCoq(row.id)}
                          >
                            {isSaving ? (
                              <IconLoader2 className="size-4 animate-spin" />
                            ) : (
                              <IconCheck className="size-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={3}
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
                      {[10, 20, 50, 100].map((n) => (
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
                    onClick={() =>
                      updateParams({ page: Math.max(1, params.page - 1) })
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
                      updateParams({
                        page: Math.min(data.totalPages, params.page + 1),
                      })
                    }
                  >
                    <IconChevronRight className="size-4" />
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
