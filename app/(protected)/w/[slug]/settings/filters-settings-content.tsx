'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDownIcon, XIcon } from 'lucide-react'

import { useWorkspace } from '@/hooks/use-workspace'
import { can } from '@/lib/features'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type FiltersSettings = {
  skippedShopifyOrderTags: string[]
  skipZeroSalesOrders: boolean
}

export function FiltersSettingsContent() {
  const { current } = useWorkspace()
  const slug = current.slug
  const canChange = can.changeSettings(current.userRole)
  const queryClient = useQueryClient()

  const [skippedTags, setSkippedTags] = useState<string[]>([])
  const [skipZeroSales, setSkipZeroSales] = useState(false)
  const [tagSearch, setTagSearch] = useState('')
  const [popoverOpen, setPopoverOpen] = useState(false)

  const { data: settingsData, isLoading: settingsLoading } = useQuery<FiltersSettings>({
    queryKey: ['workspace-settings', slug],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${slug}/workspace-settings`)
      if (!res.ok) throw new Error('Failed to load workspace settings')
      return res.json()
    },
  })

  const { data: tagsData } = useQuery<{ tags: string[] }>({
    queryKey: ['order-tags', slug],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${slug}/order-tags`)
      if (!res.ok) return { tags: [] }
      return res.json()
    },
  })

  useEffect(() => {
    if (settingsData) {
      setSkippedTags(settingsData.skippedShopifyOrderTags ?? [])
      setSkipZeroSales(settingsData.skipZeroSalesOrders ?? false)
    }
  }, [settingsData])

  const availableTags = useMemo(() => tagsData?.tags ?? [], [tagsData])
  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase()
    if (!q) return availableTags
    return availableTags.filter((t) => t.toLowerCase().includes(q))
  }, [availableTags, tagSearch])

  const mutation = useMutation({
    mutationFn: async (payload: FiltersSettings) => {
      const res = await fetch(`/api/workspaces/${slug}/workspace-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to save')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-settings', slug] })
      toast.success('Filters saved')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleSave = () => {
    mutation.mutate({
      skippedShopifyOrderTags: skippedTags,
      skipZeroSalesOrders: skipZeroSales,
    })
  }

  const toggleTag = (tag: string) => {
    setSkippedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 md:items-start">
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-semibold tracking-tight">Filters</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Filter out specific orders from analytics.
        </p>
      </div>

      <Card className="w-full max-w-lg flex-1 bg-muted/30">
        <CardHeader>
          <CardTitle>Skip orders with tags</CardTitle>
          <CardDescription className="sr-only">
            Select tags to exclude from analytics.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Field>
            <FieldLabel>Skip orders with tags</FieldLabel>
            <FieldContent>
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="min-h-9 w-full justify-between gap-2 font-normal text-muted-foreground"
                    aria-label="Select tags to skip"
                    disabled={!canChange}
                  >
                    <span className="truncate">
                      {skippedTags.length === 0
                        ? 'Select tags to skip...'
                        : `${skippedTags.length} tag(s) selected`}
                    </span>
                    <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                  <div className="p-2 border-b">
                    <Input
                      placeholder="Search tags..."
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                      disabled={!canChange}
                      className="h-8"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1">
                    {filteredTags.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        {availableTags.length === 0
                          ? 'No order tags in this workspace yet.'
                          : 'No tags match your search.'}
                      </p>
                    ) : (
                      <ul className="space-y-0.5">
                        {filteredTags.map((tag) => (
                          <li key={tag}>
                            <label
                              className={cn(
                                'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent'
                              )}
                            >
                              <Checkbox
                                checked={skippedTags.includes(tag)}
                                disabled={!canChange}
                                onCheckedChange={() => toggleTag(tag)}
                              />
                              <span>{tag}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              {skippedTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {skippedTags.map((tag) => (
                    <span
                      key={tag}
                      className="bg-muted text-foreground inline-flex h-[calc(var(--spacing)*5.5)] items-center gap-1 rounded-sm px-1.5 text-xs font-medium"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => setSkippedTags((p) => p.filter((t) => t !== tag))}
                        disabled={!canChange}
                        className="rounded p-0.5 opacity-50 hover:opacity-100"
                        aria-label={`Remove ${tag}`}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <FieldDescription>
                Orders with any of these tags will be excluded from all analytics. Leave
                empty to include all orders.
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldContent>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={skipZeroSales}
                  disabled={!canChange}
                  onCheckedChange={(c) => setSkipZeroSales(Boolean(c))}
                />
                <span className="text-sm font-medium">
                  Skip orders with 0 in sales (before refunds).
                </span>
              </label>
              <FieldDescription>
                Useful if you create free orders when gifting to influencers.
              </FieldDescription>
            </FieldContent>
          </Field>

          <div className="pt-2">
            <Button onClick={handleSave} disabled={!canChange || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
