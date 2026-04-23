'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { IconLoader2 } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWorkspace } from '@/hooks/use-workspace'
import { can } from '@/lib/features'
import { format, subDays, endOfDay } from 'date-fns'

const INTENTS = [
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'acquisition', label: 'Acquisition' },
  { value: 'non_acquisition', label: 'Non-acquisition' },
  { value: 'brand', label: 'Brand' },
] as const

type Row = {
  platform: string
  campaignId: string
  campaignName: string
  spend: number
  intent: string
}

type IntentSummary = {
  totalSpend: number
  spendByIntent: Record<string, number>
  campaignCountByIntent: Record<string, number>
  pctUnclassified: number
  spendReconciles: boolean
}

export function AdCampaignsContent({
  slug,
  isOwner,
}: {
  slug: string
  isOwner: boolean
}) {
  const { current } = useWorkspace()
  const canChange = can.changeSettings(current.userRole)
  const [rows, setRows] = useState<Row[]>([])
  const [intentSummary, setIntentSummary] = useState<IntentSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState<'all' | 'meta' | 'google'>('all')

  const now = new Date()
  const defaultTo = format(endOfDay(now), 'yyyy-MM-dd')
  const defaultFrom = format(subDays(now, 89), 'yyyy-MM-dd')

  const load = () => {
    setLoading(true)
    setError(null)
    fetch(
      `/api/workspaces/${slug}/campaign-classifications?from=${defaultFrom}&to=${defaultTo}`
    )
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setError(j.error)
        else {
          setRows(j.campaigns ?? [])
          setIntentSummary(j.intentSummary ?? null)
        }
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [slug])

  const filteredRows = useMemo(() => {
    let list = rows
    if (platformFilter !== 'all') {
      list = list.filter((r) => r.platform === platformFilter)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (r) =>
        r.campaignName.toLowerCase().includes(q) ||
        r.campaignId.toLowerCase().includes(q) ||
        r.platform.toLowerCase().includes(q) ||
        INTENTS.find((i) => i.value === r.intent)?.label.toLowerCase().includes(q)
    )
  }, [rows, search, platformFilter])

  const updateIntent = async (row: Row, intent: string) => {
    if (!canChange) return
    const key = `${row.platform}:${row.campaignId}`
    setSaving(key)
    try {
      const res = await fetch(`/api/workspaces/${slug}/campaign-classifications`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: row.platform,
          campaignId: row.campaignId,
          intent,
          campaignName: row.campaignName || undefined,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Save failed')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  const fmt = (n: number) =>
    `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 py-4">
      <div>
        <h2 className="text-lg font-semibold">Ad campaign classification</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Tag campaigns as <strong>Acquisition</strong> for aMER on{' '}
          <Link href={`/w/${slug}/acquisition`} className="underline">
            Acquisition
          </Link>
          . Splits appear on{' '}
          <Link href={`/w/${slug}/meta-ads`} className="underline">
            Meta
          </Link>{' '}
          &{' '}
          <Link href={`/w/${slug}/google-ads`} className="underline">
            Google
          </Link>{' '}
          Ads. Window: last 90 days spend.
        </p>
      </div>

      {!canChange && (
        <p className="text-sm text-muted-foreground">Only workspace owners can edit classifications.</p>
      )}

      {intentSummary && rows.length > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Summary (90d)</h3>
            <span
              className={`text-xs ${intentSummary.spendReconciles ? 'text-emerald-600' : 'text-destructive'}`}
            >
              {intentSummary.spendReconciles
                ? '✓ Spend reconciles across intents'
                : 'Spend split mismatch — refresh or report'}
            </span>
          </div>
          <div className="rounded-lg border-2 border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/25 px-4 py-3">
            <p className="text-xs font-medium text-amber-900 dark:text-amber-200 uppercase">
              Unclassified spend
            </p>
            <p className="text-2xl font-bold tabular-nums mt-1">
              {fmt(intentSummary.spendByIntent.unclassified ?? 0)}
            </p>
            <p className="text-sm text-muted-foreground">
              {intentSummary.pctUnclassified.toFixed(1)}% of total · classify below to improve
              aMER and ad reports
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {INTENTS.map((i) => (
              <div key={i.value} className="rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">{i.label}</p>
                <p className="font-semibold tabular-nums">{fmt(intentSummary.spendByIntent[i.value] ?? 0)}</p>
                <p className="text-xs text-muted-foreground">
                  {intentSummary.campaignCountByIntent[i.value] ?? 0} campaign
                  {(intentSummary.campaignCountByIntent[i.value] ?? 0) !== 1 ? 's' : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search campaign name, ID, platform, intent…"
          className="max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={platformFilter}
          onValueChange={(v) => setPlatformFilter(v as 'all' | 'meta' | 'google')}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="meta">Meta</SelectItem>
            <SelectItem value="google">Google</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No Meta or Google campaign spend in this window. Connect ads and sync data first.
        </p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="p-3 font-medium">Platform</th>
                <th className="p-3 font-medium">Campaign</th>
                <th className="p-3 font-medium text-right">Spend</th>
                <th className="p-3 font-medium w-[200px]">Intent</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const key = `${row.platform}:${row.campaignId}`
                return (
                  <tr key={key} className="border-b last:border-0">
                    <td className="p-3 capitalize">{row.platform}</td>
                    <td className="p-3 max-w-[280px] truncate" title={row.campaignName}>
                      {row.campaignName || row.campaignId}
                    </td>
                    <td className="p-3 text-right tabular-nums">{fmt(row.spend)}</td>
                    <td className="p-3">
                      <Select
                        value={row.intent}
                        disabled={!canChange || saving === key}
                        onValueChange={(v) => updateIntent(row, v)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INTENTS.map((i) => (
                            <SelectItem key={i.value} value={i.value}>
                              {i.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredRows.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">No campaigns match filters.</p>
          )}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={load} disabled={loading}>
        Refresh
      </Button>
    </div>
  )
}
