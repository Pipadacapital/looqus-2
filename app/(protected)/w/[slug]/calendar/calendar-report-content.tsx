'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, addMonths, parseISO } from 'date-fns'
import {
  IconLoader2,
  IconPlus,
  IconPencil,
  IconTrash,
  IconMail,
  IconMessage,
  IconDiscount,
  IconRocket,
  IconSpeakerphone,
  IconPhoto,
  IconCalendarEvent,
  IconFlame,
  IconDotsVertical,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CalendarMetricCell } from '@/lib/metrics/calendar-report'
import { MARKETING_ACTION_TYPES } from '@/lib/metrics/calendar-report'
import type { GoalRag } from '@/lib/metrics/goals'

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email_campaign: IconMail,
  sms_campaign: IconMessage,
  promotion: IconDiscount,
  product_launch: IconRocket,
  influencer: IconSpeakerphone,
  ad_creative_change: IconPhoto,
  external_event: IconCalendarEvent,
  sale_event: IconFlame,
}

const ACTION_LABELS: Record<string, string> = {
  email_campaign: 'Email',
  sms_campaign: 'SMS',
  promotion: 'Promotion',
  product_launch: 'Product launch',
  influencer: 'Influencer',
  ad_creative_change: 'Creative',
  external_event: 'External',
  sale_event: 'Sale',
}

type Row = {
  periodKey: string
  label: string
  actions: Array<{
    id: string
    actionDate: string
    actionType: string
    actionName: string
    notes: string | null
    source?: 'manual' | 'klaviyo'
  }>
  revenue: CalendarMetricCell
  cm3: CalendarMetricCell
  totalSpend: number
  mer: CalendarMetricCell
  amer: CalendarMetricCell
  newCustomers: CalendarMetricCell
  cac: CalendarMetricCell
  aov: CalendarMetricCell
}

type Festival = {
  id: string
  name: string
  startDate: string
  endDate: string
  color: string
  expectedMultiplier: number
  isActive: boolean
}

function fmtMoney(v: number | null, currency: string) {
  if (v == null) return '—'
  const code = (currency || 'USD').trim().toUpperCase()
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(v)
  }
}

function fmtRatio(v: number | null) {
  if (v == null) return '—'
  return `${v.toFixed(2)}×`
}

function fmtInt(v: number | null) {
  if (v == null) return '—'
  return v.toLocaleString('en-IN')
}

function ragBg(r: GoalRag | null) {
  if (r === 'green') return 'bg-emerald-500/12 dark:bg-emerald-500/20'
  if (r === 'amber') return 'bg-amber-500/12 dark:bg-amber-500/20'
  if (r === 'red') return 'bg-red-500/12 dark:bg-red-500/20'
  return ''
}

function MetricCol({
  label,
  cell,
  fmt,
}: {
  label: string
  cell: CalendarMetricCell
  fmt: (n: number | null) => string
}) {
  return (
    <div className="min-w-[100px]">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
      <div className={`rounded-md px-2 py-1.5 ${ragBg(cell.rag)}`}>
        <div className="text-sm font-semibold tabular-nums leading-tight">{fmt(cell.actual)}</div>
        <div className="text-[10px] text-muted-foreground">Goal {fmt(cell.goal)}</div>
      </div>
    </div>
  )
}

function currentMonthYm() {
  return format(new Date(), 'yyyy-MM')
}

export function CalendarReportContent({ workspaceSlug }: { workspaceSlug: string }) {
  const [selectedMonth, setSelectedMonth] = useState(currentMonthYm)
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')
  const [rows, setRows] = useState<Row[]>([])
  const [currency, setCurrency] = useState('INR')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [festivalsInMonth, setFestivalsInMonth] = useState<Festival[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/calendar-report?month=${encodeURIComponent(selectedMonth)}&granularity=${granularity}`
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setRows(json.rows ?? [])
      setCurrency(json.currency ?? 'INR')

      const y = selectedMonth.slice(0, 4)
      const festRes = await fetch(`/api/workspaces/${workspaceSlug}/festivals?year=${encodeURIComponent(y)}`)
      const festJson = await festRes.json().catch(() => ({ festivals: [] }))
      const firstDayOfMonth = parseISO(`${selectedMonth}-01T00:00:00.000Z`)
      const nextMonth = addMonths(firstDayOfMonth, 1)
      const lastDayOfMonth = new Date(nextMonth.getTime() - 1)
      const active = (festJson.festivals ?? []).filter((f: Festival) => {
        if (!f.isActive) return false
        const s = new Date(f.startDate)
        const e = new Date(f.endDate)
        return s <= lastDayOfMonth && e >= firstDayOfMonth
      })
      setFestivalsInMonth(active)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setRows([])
      setFestivalsInMonth([])
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug, selectedMonth, granularity])

  useEffect(() => {
    load()
  }, [load])

  const [addOpen, setAddOpen] = useState(false)
  const [addDate, setAddDate] = useState(() => `${selectedMonth}-01`)
  const [addType, setAddType] = useState<string>(MARKETING_ACTION_TYPES[0])
  const [addName, setAddName] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editType, setEditType] = useState('')
  const [editName, setEditName] = useState('')
  const [editNotes, setEditNotes] = useState('')

  useEffect(() => {
    if (addOpen) {
      const today = format(new Date(), 'yyyy-MM-dd')
      const prefix = selectedMonth
      setAddDate(today.startsWith(prefix) ? today : `${prefix}-01`)
    }
  }, [addOpen, selectedMonth])

  function shiftMonth(delta: number) {
    const d = addMonths(parseISO(`${selectedMonth}-01T12:00:00.000Z`), delta)
    setSelectedMonth(format(d, 'yyyy-MM'))
  }

  async function submitAdd() {
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/marketing-actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionDate: addDate,
          actionType: addType,
          actionName: addName,
          notes: addNotes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setAddOpen(false)
      setAddName('')
      setAddNotes('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(a: Row['actions'][0]) {
    if (a.source === 'klaviyo') return
    setEditId(a.id)
    setEditDate(a.actionDate)
    setEditType(a.actionType)
    setEditName(a.actionName)
    setEditNotes(a.notes ?? '')
  }

  async function submitEdit() {
    if (!editId) return
    setSaving(true)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/marketing-actions?id=${encodeURIComponent(editId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionDate: editDate,
            actionType: editType,
            actionName: editName,
            notes: editNotes || null,
          }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Update failed')
      setEditId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteAction(id: string) {
    if (!confirm('Delete this action?')) return
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/marketing-actions?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Delete failed')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const festivalForDate = (dateIso: string): Festival | null => {
    const d = new Date(dateIso)
    const overlap = festivalsInMonth.filter((f) => {
      const s = new Date(f.startDate)
      const e = new Date(f.endDate)
      return d >= s && d <= e
    })
    if (overlap.length === 0) return null
    return overlap.sort((a, b) => b.expectedMultiplier - a.expectedMultiplier)[0]
  }

  return (
    <div className="space-y-6 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calendar report</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Month view: every day in the selected month vs goals (RAG) and marketing actions. Revenue
          uses the same store net + order gap-fill as MER/P&amp;L when analytics daily lags.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => shiftMonth(-1)}>
            ←
          </Button>
          <div className="flex flex-col gap-0.5">
            <Label className="text-[10px] text-muted-foreground sr-only">Month</Label>
            <Input
              type="month"
              className="w-[160px]"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => shiftMonth(1)}>
            →
          </Button>
        </div>
        <Select
          value={granularity}
          onValueChange={(v) => setGranularity(v as 'day' | 'week' | 'month')}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">By day</SelectItem>
            <SelectItem value="week">By week</SelectItem>
            <SelectItem value="month">By month</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setAddOpen(true)} size="sm">
          <IconPlus className="size-4 mr-1" />
          Add action
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-lg border bg-card p-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-700 dark:text-violet-300">
          Klaviyo sends (violet)
        </span>
        <span className="font-medium text-foreground">Manual actions:</span>
        {MARKETING_ACTION_TYPES.map((t) => {
          const Ic = ACTION_ICONS[t] ?? IconDotsVertical
          return (
            <span key={t} className="inline-flex items-center gap-1">
              <Ic className="size-3.5 shrink-0" />
              {ACTION_LABELS[t]}
            </span>
          )
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground py-8">
          No rows. Connect Shopify to load this month.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-20 bg-card w-[120px] min-w-[120px] shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]">
                  Date
                </TableHead>
                <TableHead className="sticky left-[120px] z-20 bg-card w-[130px] min-w-[130px] border-r shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]">
                  Actions
                </TableHead>
                <TableHead className="min-w-[520px]">
                  <span className="sr-only">Metrics</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                (() => {
                  const rowDate = r.periodKey?.length >= 10 ? `${r.periodKey.slice(0, 10)}T12:00:00.000Z` : ''
                  const rowFestival = rowDate ? festivalForDate(rowDate) : null
                  return (
                <TableRow key={r.periodKey}>
                  <TableCell
                    title={
                      rowFestival
                        ? `${rowFestival.name} • ${rowFestival.expectedMultiplier}x expected lift`
                        : undefined
                    }
                    className="sticky left-0 z-10 bg-card align-top font-medium text-sm whitespace-nowrap py-3 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]"
                    style={rowFestival ? { borderLeft: `4px solid ${rowFestival.color}` } : undefined}
                  >
                    {r.label}
                  </TableCell>
                  <TableCell className="sticky left-[120px] z-10 bg-card border-r align-top py-2 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]">
                    <div className="flex flex-wrap gap-1">
                      {r.actions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        r.actions.map((a) => {
                          const Ic = ACTION_ICONS[a.actionType] ?? IconDotsVertical
                          const isKlaviyo = a.source === 'klaviyo'
                          return (
                            <DropdownMenu key={a.id}>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className={`inline-flex rounded-md border p-1 hover:bg-muted ${
                                    isKlaviyo ? 'bg-violet-500/10 border-violet-500/30' : 'bg-muted/50'
                                  }`}
                                  title={a.actionName}
                                >
                                  <Ic className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="w-56">
                                <div className="px-2 py-1.5 text-xs border-b">
                                  {isKlaviyo && (
                                    <p className="text-[10px] uppercase tracking-wide text-violet-600 mb-1">
                                      Klaviyo
                                    </p>
                                  )}
                                  <p className="font-medium">{a.actionName}</p>
                                  <p className="text-muted-foreground">
                                    {a.actionDate} · {ACTION_LABELS[a.actionType] ?? a.actionType}
                                  </p>
                                  {a.notes ? <p className="mt-1 text-foreground">{a.notes}</p> : null}
                                </div>
                                {!isKlaviyo && (
                                  <>
                                    <DropdownMenuItem onClick={() => openEdit(a)}>
                                      <IconPencil className="size-3.5 mr-2" />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={() => deleteAction(a.id)}
                                    >
                                      <IconTrash className="size-3.5 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )
                        })
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex flex-wrap gap-3 items-start">
                      <MetricCol
                        label="Revenue"
                        cell={r.revenue}
                        fmt={(v) => fmtMoney(v, currency)}
                      />
                      <MetricCol
                        label="CM3"
                        cell={r.cm3}
                        fmt={(v) => fmtMoney(v, currency)}
                      />
                      <div className="min-w-[88px]">
                        <p className="text-[9px] uppercase text-muted-foreground mb-0.5">
                          Tot spend
                        </p>
                        <div className="text-sm font-semibold tabular-nums py-1.5">
                          {fmtMoney(r.totalSpend, currency)}
                        </div>
                      </div>
                      <MetricCol label="MER" cell={r.mer} fmt={fmtRatio} />
                      <MetricCol label="aMER" cell={r.amer} fmt={fmtRatio} />
                      <MetricCol
                        label="New NC"
                        cell={r.newCustomers}
                        fmt={(v) => (v == null ? '—' : fmtInt(v))}
                      />
                      <MetricCol
                        label="CAC"
                        cell={r.cac}
                        fmt={(v) => fmtMoney(v, currency)}
                      />
                      <MetricCol
                        label="AOV"
                        cell={r.aov}
                        fmt={(v) => fmtMoney(v, currency)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
                  )
                })()
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && festivalsInMonth.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Festivals this month:{' '}
          {festivalsInMonth.map((f, i) => (
            <span key={f.id} className="mr-4 inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: f.color }} />
              {f.name} ({format(new Date(f.startDate), 'MMM d')}–{format(new Date(f.endDate), 'MMM d')}) {f.expectedMultiplier}x
              {i < festivalsInMonth.length - 1 ? '' : ''}
            </span>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add marketing action</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Date</Label>
              <Input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={addType} onValueChange={setAddType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETING_ACTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ACTION_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Campaign or event name"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={addNotes} onChange={(e) => setAddNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitAdd} disabled={saving || !addName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit action</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Date</Label>
              <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={editType} onValueChange={setEditType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETING_ACTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ACTION_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)}>
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={saving}>
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
