'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconChevronLeft,
  IconChevronRight,
  IconLoader2,
  IconCheck,
  IconEdit,
} from '@tabler/icons-react'
import { toast } from 'sonner'

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

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

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ARCHIVED', label: 'Archived' },
] as const

function useCoqsParams() {
  const searchParams = useSearchParams()
  const page = Number(searchParams.get('page')) || 1
  const pageSize = Number(searchParams.get('pageSize')) || 20
  const search = searchParams.get('search') || ''
  const coqFilter = searchParams.get('coqFilter') || ''
  const status = searchParams.get('status') || ''
  return { page, pageSize, search, coqFilter, status }
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

  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkSearch, setBulkSearch] = useState('')
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkCoqFilter, setBulkCoqFilter] = useState('')
  const [bulkPage, setBulkPage] = useState(1)
  const [bulkPageSize, setBulkPageSize] = useState(50)
  const [bulkLocalCoq, setBulkLocalCoq] = useState<Record<string, string>>({})
  const [bulkSaveLoading, setBulkSaveLoading] = useState(false)
  const [bulkSetEmptyValue, setBulkSetEmptyValue] = useState('')

  useEffect(() => {
    if (bulkDialogOpen) {
      setBulkLocalCoq({})
      setBulkPage(1)
    }
  }, [bulkDialogOpen])

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
    { value: 'set', label: 'COGS set' },
    { value: 'not_set', label: 'COGS not set' },
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
      if (params.status) q.set('status', params.status)
      const res = await fetch(`/api/workspaces/${slug}/store/products?${q.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load products')
      }
      return res.json()
    },
  })

  const bulkFilters = {
    search: bulkSearch,
    status: bulkStatus,
    coqFilter: bulkCoqFilter,
    page: bulkPage,
    pageSize: bulkPageSize,
  }
  const { data: bulkData, isLoading: bulkLoading } = useQuery<ProductsResponse>({
    queryKey: ['store', 'products', 'bulk', slug, bulkFilters],
    queryFn: async () => {
      const q = new URLSearchParams()
      q.set('page', String(bulkPage))
      q.set('pageSize', String(bulkPageSize))
      q.set('sort', 'title')
      q.set('order', 'asc')
      if (bulkSearch) q.set('search', bulkSearch)
      if (bulkCoqFilter) q.set('coqFilter', bulkCoqFilter)
      if (bulkStatus) q.set('status', bulkStatus)
      const res = await fetch(`/api/workspaces/${slug}/store/products?${q.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load products')
      }
      return res.json()
    },
    enabled: bulkDialogOpen,
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

  // Save uses the *displayed* value so it works even when user didn't type (e.g. re-saving current value)
  const handleSaveCoq = (productId: string, currentCoq: number | null) => {
    const displayed = getCoqInputValue(productId, currentCoq)
    const value =
      displayed === ''
        ? null
        : Number.parseFloat(displayed)
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      toast.error('Enter a valid non-negative number')
      return
    }
    patchCoqMutation.mutate(
      { productId, coq: value },
      {
        onSuccess: () => {
          setLocalCoq((prev) => {
            const next = { ...prev }
            delete next[productId]
            return next
          })
          toast.success('COGS saved')
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : 'Failed to save COGS')
        },
      }
    )
  }

  const getCoqInputValue = (productId: string, currentCoq: number | null) => {
    if (productId in localCoq) return localCoq[productId]
    return currentCoq != null ? String(currentCoq) : ''
  }

  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const focusNextInput = (currentIndex: number) => {
    const next = inputRefs.current[currentIndex + 1]
    if (next) {
      next.focus()
    }
  }

  const getBulkCoqValue = (productId: string, currentCoq: number | null) => {
    if (productId in bulkLocalCoq) return bulkLocalCoq[productId]
    return currentCoq != null ? String(currentCoq) : ''
  }

  const getBulkChanges = useCallback(() => {
    if (!bulkData?.data) return []
    return bulkData.data
      .map((row) => {
        const displayed = getBulkCoqValue(row.id, row.coq)
        const newVal =
          displayed === ''
            ? null
            : (() => {
                const n = Number.parseFloat(displayed)
                return Number.isNaN(n) || n < 0 ? undefined : n
              })()
        if (newVal === undefined) return null
        const currentVal = row.coq != null ? Number(row.coq) : null
        if (newVal === currentVal) return null
        return { productId: row.id, coq: newVal }
      })
      .filter((x): x is { productId: string; coq: number | null } => x != null)
  }, [bulkData?.data, bulkLocalCoq])

  const handleBulkSave = async () => {
    const changes = getBulkChanges()
    if (changes.length === 0) {
      toast.info('No changes to save')
      return
    }
    setBulkSaveLoading(true)
    const BATCH = 5
    let ok = 0
    let fail = 0
    for (let i = 0; i < changes.length; i += BATCH) {
      const batch = changes.slice(i, i + BATCH)
      const results = await Promise.allSettled(
        batch.map(({ productId, coq }) =>
          fetch(`/api/workspaces/${slug}/store/products/${productId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coq }),
          })
        )
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok) ok++
        else fail++
      }
    }
    setBulkSaveLoading(false)
    queryClient.invalidateQueries({ queryKey: ['store', 'products', 'coqs', slug] })
    queryClient.invalidateQueries({ queryKey: ['store', 'products', slug] })
    queryClient.invalidateQueries({ queryKey: ['store', 'products', 'bulk', slug] })
    if (fail === 0) {
      toast.success(`Saved COGS for ${ok} product${ok !== 1 ? 's' : ''}`)
      setBulkLocalCoq({})
      setBulkDialogOpen(false)
    } else {
      toast.warning(`Saved ${ok}, failed ${fail}`)
    }
  }

  const handleBulkSetEmptyTo = () => {
    const val = bulkSetEmptyValue.trim()
    if (val === '') return
    const n = Number.parseFloat(val)
    if (Number.isNaN(n) || n < 0) {
      toast.error('Enter a valid non-negative number')
      return
    }
    if (!bulkData?.data) return
    const next = { ...bulkLocalCoq }
    let count = 0
    for (const row of bulkData.data) {
      const current = row.coq != null ? String(row.coq) : ''
      if (current === '' && next[row.id] === undefined) {
        next[row.id] = val
        count++
      }
    }
    setBulkLocalCoq(next)
    toast.success(`Set ${count} empty COGS to ${val}`)
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
        <Select
          value={params.coqFilter || '__all__'}
          onValueChange={(v) =>
            updateParams({ coqFilter: v === '__all__' ? '' : v, page: 1 })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="COGS filter" />
          </SelectTrigger>
          <SelectContent>
            {COQ_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value || '__all__'} value={o.value || '__all__'}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm" className="gap-2">
              <IconEdit className="size-4" />
              Bulk set COGS
            </Button>
          </DialogTrigger>
          <DialogContent
            className="max-w-6xl sm:max-w-4xl sm:w-[95vw] w-[95vw] h-[90vh] flex flex-col gap-0 p-0"
            showCloseButton={true}
          >
            <DialogHeader className="p-6 pb-4 shrink-0">
              <DialogTitle>Bulk set COGS</DialogTitle>
              <DialogDescription>
                Filter products in the sidebar, edit COGS in the table, then click
                Save to apply all changes at once.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-1 min-h-0">
              <aside className="w-64 shrink-0 flex flex-col gap-4 border-r bg-muted/30 p-4 overflow-y-auto">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Search</label>
                  <Input
                    placeholder="Search products..."
                    className="w-full"
                    value={bulkSearch}
                    onChange={(e) => setBulkSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setBulkPage(1)
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select
                    value={bulkStatus || '__all__'}
                    onValueChange={(v) => {
                      setBulkStatus(v === '__all__' ? '' : v)
                      setBulkPage(1)
                    }}
                  >
                    <SelectTrigger className="w-full">
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
                <div className="space-y-2">
                  <label className="text-sm font-medium">COGS filter</label>
                  <Select
                    value={bulkCoqFilter || '__all__'}
                    onValueChange={(v) => {
                      setBulkCoqFilter(v === '__all__' ? '' : v)
                      setBulkPage(1)
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="COGS filter" />
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
                <div className="space-y-2 pt-2 border-t">
                  <label className="text-sm font-medium">Set all empty to</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="0"
                      className="flex-1"
                      value={bulkSetEmptyValue}
                      onChange={(e) => setBulkSetEmptyValue(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleBulkSetEmptyTo}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </aside>
              <div className="flex flex-col flex-1 min-w-0">
                <div className="flex-1 min-h-0 overflow-auto px-6">
              {bulkLoading ? (
                <div className="flex items-center justify-center py-16">
                  <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
              ) : bulkData?.data.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="w-[160px]">COGS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bulkData.data.map((row) => {
                      const inputValue = getBulkCoqValue(row.id, row.coq)
                      return (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="relative size-9 shrink-0 overflow-hidden rounded border bg-muted">
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
                                <div className="font-medium text-sm">{row.title}</div>
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
                                setBulkLocalCoq((prev) => ({
                                  ...prev,
                                  [row.id]: e.target.value,
                                }))
                              }
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-16 text-center text-muted-foreground text-sm">
                  No products found. Adjust filters or search.
                </div>
              )}
            </div>
            {bulkData && bulkData.totalPages > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-3">
                <p className="text-muted-foreground text-sm">
                  {bulkData.total} product{bulkData.total !== 1 ? 's' : ''}
                  {bulkData.data.length < bulkData.total &&
                    ` (showing page ${bulkPage})`}
                </p>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(bulkPageSize)}
                    onValueChange={(v) => {
                      setBulkPageSize(Number(v))
                      setBulkPage(1)
                    }}
                  >
                    <SelectTrigger className="w-20" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[20, 50].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground text-sm">
                    Page {bulkPage} of {bulkData.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    disabled={bulkPage <= 1}
                    onClick={() => setBulkPage((p) => Math.max(1, p - 1))}
                  >
                    <IconChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    disabled={bulkPage >= bulkData.totalPages}
                    onClick={() =>
                      setBulkPage((p) =>
                        Math.min(bulkData.totalPages, p + 1)
                      )
                    }
                  >
                    <IconChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}
            </div>
            </div>
            <DialogFooter className="p-6 pt-4 border-t shrink-0">
              <Button
                variant="outline"
                onClick={() => setBulkDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={bulkSaveLoading || getBulkChanges().length === 0}
                onClick={handleBulkSave}
              >
                {bulkSaveLoading ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <IconCheck className="size-4" />
                    {getBulkChanges().length > 0
                      ? `Save (${getBulkChanges().length})`
                      : 'Save'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
                  <TableHead className="w-[180px]">COGS</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.data.length ? (
                  data.data.map((row, index) => {
                    const inputValue = getCoqInputValue(row.id, row.coq)
                    const isSaving = patchCoqMutation.isPending && patchCoqMutation.variables?.productId === row.id
                    const savedValue = row.coq != null ? String(row.coq) : ''
                    const hasChanged = inputValue !== savedValue
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
                            ref={(el) => {
                              inputRefs.current[index] = el
                            }}
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
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                if (hasChanged) {
                                  handleSaveCoq(row.id, row.coq)
                                  focusNextInput(index)
                                } else {
                                  focusNextInput(index)
                                }
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSaving || !hasChanged}
                            onClick={() => handleSaveCoq(row.id, row.coq)}
                            title={hasChanged ? 'Save COGS' : 'No changes to save'}
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
