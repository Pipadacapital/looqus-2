'use client'

import { useCallback, useEffect, useState } from 'react'
import { IconLoader2, IconTarget, IconTrash } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspace } from '@/hooks/use-workspace'
import { can } from '@/lib/features'
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
  GOAL_METRIC_REGISTRY,
  type GoalMetricId,
} from '@/lib/metrics/goal-metrics-registry'

type GoalRow = {
  id: string
  metricName: string
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  periodStart: string
  goalValue: number
  goalType: 'MINIMUM' | 'MAXIMUM' | 'TARGET'
  updatedAt: string
}

const PERIODS: GoalRow['periodType'][] = ['DAILY', 'WEEKLY', 'MONTHLY']
const GOAL_TYPES: GoalRow['goalType'][] = ['TARGET', 'MINIMUM', 'MAXIMUM']

export function GoalsSettingsContent({ workspaceSlug }: { workspaceSlug: string }) {
  const { current } = useWorkspace()
  const canChange = can.changeSettings(current.userRole)
  const [goals, setGoals] = useState<GoalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metricName, setMetricName] = useState<GoalMetricId>('revenue')
  const [periodType, setPeriodType] = useState<GoalRow['periodType']>('MONTHLY')
  const [periodStart, setPeriodStart] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [goalValue, setGoalValue] = useState('')
  const [goalType, setGoalType] = useState<GoalRow['goalType']>('TARGET')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/goals`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setGoals(json.goals ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug])

  useEffect(() => {
    load()
  }, [load])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const v = parseFloat(goalValue)
    if (Number.isNaN(v)) {
      setError('Enter a valid goal value')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metricName,
          periodType,
          periodStart,
          goalValue: v,
          goalType,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setGoalValue('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this goal?')) return
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/goals?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Delete failed')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <IconTarget className="size-5" />
          Metric goals
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Set targets by period. KPI cards compare your selected date range to the goal for the
          period containing the range end (daily → weekly → monthly precedence). Calendar and alerts
          will build on this later.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="rounded-xl border bg-card p-6 space-y-4">
        <h3 className="text-sm font-medium">Add or update goal</h3>
        <p className="text-xs text-muted-foreground">
          Same metric + period type + period start updates the existing row. Monthly/week start is
          normalized automatically (e.g. any day in March → March 1 for monthly).
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Metric</label>
            <Select
              value={metricName}
              onValueChange={(v) => setMetricName(v as GoalMetricId)}
              disabled={!canChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {(Object.keys(GOAL_METRIC_REGISTRY) as GoalMetricId[]).map((id) => (
                  <SelectItem key={id} value={id}>
                    {GOAL_METRIC_REGISTRY[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              {GOAL_METRIC_REGISTRY[metricName].description}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Period</label>
            <Select
              value={periodType}
              onValueChange={(v) => setPeriodType(v as GoalRow['periodType'])}
              disabled={!canChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p === 'DAILY' ? 'Daily' : p === 'WEEKLY' ? 'Weekly (Mon start)' : 'Monthly'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Period anchor date</label>
            <Input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              disabled={!canChange}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Goal value</label>
            <Input
              type="number"
              step="any"
              placeholder="e.g. 4.5 for MER"
              value={goalValue}
              onChange={(e) => setGoalValue(e.target.value)}
              disabled={!canChange}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Goal type</label>
            <Select
              value={goalType}
              onValueChange={(v) => setGoalType(v as GoalRow['goalType'])}
              disabled={!canChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TARGET">Target (RAG uses metric direction)</SelectItem>
                <SelectItem value="MINIMUM">Minimum — higher is better</SelectItem>
                <SelectItem value="MAXIMUM">Maximum — lower is better</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button type="submit" disabled={!canChange || saving}>
          {saving ? 'Saving…' : 'Save goal'}
        </Button>
      </form>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b px-6 py-3">
          <h3 className="text-sm font-medium">Saved goals</h3>
        </div>
        {loading ? (
          <div className="flex justify-center py-16">
            <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : goals.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No goals yet. Add revenue, MER, CAC, or other metrics above. They will appear on Store
            Analytics, Acquisition, and ad summaries when the date range matches.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Start</TableHead>
                <TableHead className="text-right">Goal</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {goals.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">
                    {GOAL_METRIC_REGISTRY[g.metricName as GoalMetricId]?.label ?? g.metricName}
                  </TableCell>
                  <TableCell>{g.periodType}</TableCell>
                  <TableCell className="tabular-nums">{g.periodStart}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.goalValue}</TableCell>
                  <TableCell>{g.goalType}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      disabled={!canChange}
                      onClick={() => handleDelete(g.id)}
                      aria-label="Delete goal"
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
