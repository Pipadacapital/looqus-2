'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspace } from '@/hooks/use-workspace'
import { can } from '@/lib/features'

type Festival = {
  id: string
  name: string
  startDate: string
  endDate: string
  color: string
  expectedMultiplier: number
  regions: string[]
  categories: string[]
  isTemplate: boolean
  isActive: boolean
}

const YEARS = [2025, 2026, 2027]
const COLORS = ['#F59E0B', '#EF4444', '#8B5CF6', '#3B82F6', '#10B981', '#EC4899']

export function FestivalsContent({
  workspaceSlug,
  workspaceName,
}: {
  workspaceSlug: string
  workspaceName: string
}) {
  const { current } = useWorkspace()
  const canChange = can.changeSettings(current.userRole)
  const [year, setYear] = useState<number>(2025)
  const [festivals, setFestivals] = useState<Festival[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Festival>>({})

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/festivals?year=${year}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load festivals')
      setFestivals(json.festivals ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load festivals')
      setFestivals([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [year])

  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }),
    []
  )

  async function saveEdit(id: string) {
    const body: Record<string, unknown> = {}
    if (draft.name != null) body.name = draft.name
    if (draft.startDate != null) body.startDate = draft.startDate
    if (draft.endDate != null) body.endDate = draft.endDate
    if (draft.color != null) body.color = draft.color
    if (draft.expectedMultiplier != null) body.expectedMultiplier = draft.expectedMultiplier
    if (draft.regions != null) body.regions = draft.regions
    if (draft.categories != null) body.categories = draft.categories
    if (draft.isActive != null) body.isActive = draft.isActive
    const res = await fetch(`/api/workspaces/${workspaceSlug}/festivals?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Update failed')
    setEditId(null)
    setDraft({})
    await load()
  }

  async function addFestival() {
    const now = `${year}-01-01`
    const res = await fetch(`/api/workspaces/${workspaceSlug}/festivals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Custom Festival ${year}`,
        startDate: now,
        endDate: now,
        color: '#3B82F6',
        expectedMultiplier: 1.6,
        regions: [],
        categories: ['all'],
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Create failed')
    await load()
  }

  async function resetDefaults() {
    await fetch(`/api/workspaces/${workspaceSlug}/festivals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetDefaults: true }),
    })
    await load()
  }

  return (
    <div className="space-y-4 py-4 md:py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Festival Calendar</h1>
          <p className="text-sm text-muted-foreground">{workspaceName}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={addFestival} disabled={!canChange}>+ Add Festival</Button>
          <Button variant="outline" onClick={resetDefaults} disabled={!canChange}>Reset to defaults</Button>
        </div>
      </div>

      <div className="flex gap-2">
        {YEARS.map((y) => (
          <Button key={y} size="sm" variant={y === year ? 'default' : 'outline'} onClick={() => setYear(y)}>
            {y}
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-lg border divide-y">
          {festivals.map((f) => {
            const symbol = f.isTemplate ? (f.isActive ? '●' : '○') : '★'
            const start = monthFmt.format(new Date(f.startDate))
            const end = monthFmt.format(new Date(f.endDate))
            const isEditing = editId === f.id
            return (
              <div key={f.id} className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span>{symbol}</span>
                    <span className="font-medium">{f.name}</span>
                    <span className="text-muted-foreground">{start}–{end}</span>
                    <span className="inline-block h-3 w-6 rounded-sm" style={{ backgroundColor: f.color }} />
                    <span>{f.expectedMultiplier.toFixed(1)}x</span>
                    <span className="text-muted-foreground">{f.regions.length ? f.regions.join(', ') : 'All India'}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={!canChange} onClick={() => { setEditId(f.id); setDraft({ ...f }) }}>Edit</Button>
                    {f.isTemplate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canChange}
                        onClick={async () => {
                          await fetch(`/api/workspaces/${workspaceSlug}/festivals?id=${f.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ isActive: !f.isActive }),
                          })
                          await load()
                        }}
                      >
                        {f.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canChange}
                        onClick={async () => {
                          await fetch(`/api/workspaces/${workspaceSlug}/festivals?id=${f.id}`, { method: 'DELETE' })
                          await load()
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                {isEditing && (
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                    <Input value={String(draft.name ?? '')} disabled={!canChange} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" />
                    <Input type="date" disabled={!canChange} value={String(draft.startDate ?? '').slice(0, 10)} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} />
                    <Input type="date" disabled={!canChange} value={String(draft.endDate ?? '').slice(0, 10)} onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} />
                    <div className="flex gap-1 items-center">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          className="h-6 w-6 rounded border"
                          style={{ backgroundColor: c }}
                          disabled={!canChange}
                          onClick={() => setDraft((d) => ({ ...d, color: c }))}
                          type="button"
                        />
                      ))}
                    </div>
                    <Input
                      type="number"
                      min={0.5}
                      max={6}
                      step={0.1}
                      disabled={!canChange}
                      value={String(draft.expectedMultiplier ?? 1.5)}
                      onChange={(e) => setDraft((d) => ({ ...d, expectedMultiplier: Number(e.target.value) }))}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={!canChange} onClick={() => saveEdit(f.id)}>Save</Button>
                      <Button size="sm" variant="outline" onClick={() => { setEditId(null); setDraft({}) }}>Cancel</Button>
                    </div>
                    <Input
                      className="md:col-span-3"
                      disabled={!canChange}
                      placeholder="Regions (comma-separated)"
                      value={Array.isArray(draft.regions) ? draft.regions.join(', ') : ''}
                      onChange={(e) => setDraft((d) => ({ ...d, regions: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }))}
                    />
                    <Input
                      className="md:col-span-3"
                      disabled={!canChange}
                      placeholder="Categories (comma-separated)"
                      value={Array.isArray(draft.categories) ? draft.categories.join(', ') : ''}
                      onChange={(e) => setDraft((d) => ({ ...d, categories: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }))}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
