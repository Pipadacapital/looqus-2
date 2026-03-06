'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useWorkspace } from '@/hooks/use-workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldContent,
} from '@/components/ui/field'

type CogsSettings = {
  overrideAllCogsPercent: number
  fallbackCogsPercent: number
  cogsMarkupPercent: number
}

function formatPercent(value: number) {
  return value.toFixed(2)
}

function parsePercent(str: string): number {
  const n = parseFloat(str)
  return Number.isFinite(n) ? n : 0
}

export function CogsSettingsContent() {
  const { current } = useWorkspace()
  const slug = current.slug
  const queryClient = useQueryClient()

  const [overrideAll, setOverrideAll] = useState('0.00')
  const [fallback, setFallback] = useState('50.00')
  const [markup, setMarkup] = useState('0.00')

  const { data, isLoading } = useQuery<CogsSettings>({
    queryKey: ['cogs-settings', slug],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${slug}/cogs-settings`)
      if (!res.ok) throw new Error('Failed to load COGS settings')
      return res.json()
    },
  })

  useEffect(() => {
    if (data) {
      setOverrideAll(formatPercent(data.overrideAllCogsPercent))
      setFallback(formatPercent(data.fallbackCogsPercent))
      setMarkup(formatPercent(data.cogsMarkupPercent))
    }
  }, [data])

  const mutation = useMutation({
    mutationFn: async (payload: CogsSettings) => {
      const res = await fetch(`/api/workspaces/${slug}/cogs-settings`, {
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
      queryClient.invalidateQueries({ queryKey: ['cogs-settings', slug] })
      toast.success('COGS settings saved')
    },
    onError: (e: Error) => {
      toast.error(e.message)
    },
  })

  const handleSave = () => {
    mutation.mutate({
      overrideAllCogsPercent: parsePercent(overrideAll),
      fallbackCogsPercent: parsePercent(fallback),
      cogsMarkupPercent: parsePercent(markup),
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 md:items-start">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">COGS Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure how Cost of Goods Sold is calculated.
        </p>
      </div>

      <Card className="w-full max-w-lg flex-1 bg-muted/30">
        <CardHeader>
          <CardTitle className="sr-only">COGS configuration</CardTitle>
          <CardDescription className="sr-only">
            Override, markup, and fallback percentages for COGS.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Field>
            <FieldLabel>Override all COGS %</FieldLabel>
            <FieldContent>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={overrideAll}
                onChange={(e) => setOverrideAll(e.target.value)}
                className="max-w-[140px]"
                aria-label="Override all COGS percentage"
              />
              <FieldDescription>
                When set above 0, overrides all COGS sources (Shopify, custom,
                fallback) with this percentage of product revenue excl. tax
                (excludes shipping). Set to 0 to disable.
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>COGS Markup %</FieldLabel>
            <FieldContent>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={markup}
                onChange={(e) => setMarkup(e.target.value)}
                className="max-w-[140px]"
                aria-label="COGS markup percentage"
              />
              <FieldDescription>
                Add a percentage markup on top of all COGS calculations. Useful
                for accounting for hidden costs like shrinkage or breakage.
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>Fallback COGS %</FieldLabel>
            <FieldContent>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={fallback}
                onChange={(e) => setFallback(e.target.value)}
                className="max-w-[140px]"
                aria-label="Fallback COGS percentage"
              />
              <FieldDescription>
                Percentage of revenue excl. tax used when variant has no cost
                data. Same base as override: (line item price × quantity) per
                product. Set to 0 to disable.
              </FieldDescription>
            </FieldContent>
          </Field>

          <div className="pt-2">
            <Button
              onClick={handleSave}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
