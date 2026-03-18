'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, subDays } from 'date-fns'
import { IconLoader2 } from '@tabler/icons-react'
import { DateRangeFilter } from '@/components/analytics'
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

type Row = {
  key: string
  label: string
  delivered: number
  uniqueOpens: number
  uniqueClicks: number
  orders: number
  revenue: number
  unsubscribes: number
  spamComplaints: number
  openRate: number
  clickRate: number
  revenuePerRecipient: number
  revenuePerUniqueOpen: number
  unsubscribeRate: number
  spamRate: number
}

function pct(x: number) {
  return `${(x * 100).toFixed(2)}%`
}

export function EmailSmsReportContent({ workspaceSlug }: { workspaceSlug: string }) {
  const [from, setFrom] = useState(() => format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [groupBy, setGroupBy] = useState<
    'campaign' | 'flow' | 'date' | 'channel' | 'dow'
  >('campaign')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/email-sms-report?from=${from}&to=${to}&groupBy=${groupBy}`
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setRows(json.rows ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug, from, to, groupBy])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Email &amp; SMS</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Klaviyo campaign &amp; flow performance. Rates use delivered as denominator where noted.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <DateRangeFilter
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          fromId="es-from"
          toId="es-to"
        />
        <Select
          value={groupBy}
          onValueChange={(v) => setGroupBy(v as typeof groupBy)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="campaign">By campaign</SelectItem>
            <SelectItem value="flow">By flow (daily)</SelectItem>
            <SelectItem value="date">By date</SelectItem>
            <SelectItem value="channel">By channel</SelectItem>
            <SelectItem value="dow">By day of week</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16">
          <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground py-8">
          No data. Connect Klaviyo in Settings → Integrations and run sync.
        </p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Name / key</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Opens</TableHead>
                <TableHead className="text-right">Open %</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">$/recipient</TableHead>
                <TableHead className="text-right">$/unique open</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Unsub</TableHead>
                <TableHead className="text-right">Unsub %</TableHead>
                <TableHead className="text-right">Spam</TableHead>
                <TableHead className="text-right">Spam %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium max-w-[280px] truncate" title={r.label}>
                    {r.label}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.delivered.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.uniqueOpens.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.openRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.uniqueClicks.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.delivered > 0 ? r.revenuePerRecipient.toFixed(4) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.uniqueOpens > 0 ? r.revenuePerUniqueOpen.toFixed(4) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.unsubscribes}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.unsubscribeRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.spamComplaints}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.spamRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
