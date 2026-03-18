/**
 * Calendar report: daily workspace + acquisition metrics, goals (prorated), marketing actions.
 */
import type { PrismaClient } from '@prisma/client'
import {
  eachDayOfInterval,
  format,
  getDaysInMonth,
  isSameDay,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
} from 'date-fns'
import type { WorkspaceForMetrics } from '@/lib/workspace-metrics/compute-daily'
import { computeAcquisition, type WorkspaceForAcquisition } from '@/lib/acquisition/compute'
import { normalizeOrderFilterSettings, type OrderFilterSettings } from '@/lib/metrics/order-inclusion'
import { computeCalendarDaySlicesBatched } from '@/lib/metrics/calendar-daily-batch'
import { goalPeriodAnchor, evaluateGoalRow, type GoalRag } from '@/lib/metrics/goals'
import type { GoalMetricId } from '@/lib/metrics/goal-metrics-registry'

export const MARKETING_ACTION_TYPES = [
  'email_campaign',
  'sms_campaign',
  'promotion',
  'product_launch',
  'influencer',
  'ad_creative_change',
  'external_event',
  'sale_event',
] as const

export type MarketingActionTypeV1 = (typeof MARKETING_ACTION_TYPES)[number]

export function isMarketingActionType(s: string): s is MarketingActionTypeV1 {
  return (MARKETING_ACTION_TYPES as readonly string[]).includes(s)
}

export type CalendarMetricCell = {
  actual: number | null
  goal: number | null
  rag: GoalRag | null
}

export type CalendarReportRow = {
  periodKey: string
  label: string
  actions: Array<{
    id: string
    actionDate: string
    actionType: string
    actionName: string
    notes: string | null
    /** Klaviyo-synced overlays are read-only in UI */
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

type GoalRow = NonNullable<
  Awaited<ReturnType<PrismaClient['workspaceMetricGoal']['findFirst']>>
>

const RATIO_METRICS: GoalMetricId[] = ['mer', 'amer', 'cac']

function pickGoalRow(
  metricName: string,
  dateStr: string,
  goals: GoalRow[]
): GoalRow | undefined {
  const d = parseISO(`${dateStr}T12:00:00.000Z`)
  const aD = goalPeriodAnchor('DAILY', d)
  const aW = goalPeriodAnchor('WEEKLY', d)
  const aM = goalPeriodAnchor('MONTHLY', d)
  const m = goals.filter((g) => g.metricName === metricName)
  return (
    m.find((g) => g.periodType === 'DAILY' && isSameDay(g.periodStart, aD)) ??
    m.find((g) => g.periodType === 'WEEKLY' && isSameDay(g.periodStart, aW)) ??
    m.find((g) => g.periodType === 'MONTHLY' && isSameDay(g.periodStart, aM))
  )
}

function proratedDailyNumericGoal(metricId: GoalMetricId, row: GoalRow, dateStr: string): number {
  const gv = Number(row.goalValue)
  if (RATIO_METRICS.includes(metricId)) return gv
  const d = parseISO(`${dateStr}T12:00:00.000Z`)
  if (row.periodType === 'DAILY') return gv
  if (row.periodType === 'WEEKLY') return gv / 7
  return gv / getDaysInMonth(d)
}

function sumNumericGoalsForDates(
  metricId: GoalMetricId,
  dates: string[],
  goals: GoalRow[]
): { sum: number; hasAny: boolean } {
  let sum = 0
  let hasAny = false
  for (const ds of dates) {
    const row = pickGoalRow(metricId, ds, goals)
    if (!row) continue
    hasAny = true
    sum += proratedDailyNumericGoal(metricId, row, ds)
  }
  return { sum, hasAny }
}

function ratioGoalForPeriod(
  metricId: GoalMetricId,
  dates: string[],
  goals: GoalRow[]
): GoalRow | undefined {
  if (dates.length === 0) return undefined
  const mid = dates[Math.floor(dates.length / 2)]
  return pickGoalRow(metricId, mid, goals)
}

function evalCell(
  metricId: GoalMetricId,
  actual: number | null,
  goalVal: number | null,
  goalRow: GoalRow | undefined
): CalendarMetricCell {
  if (actual == null || Number.isNaN(actual)) {
    return { actual: null, goal: goalVal, rag: null }
  }
  if (goalVal == null || !goalRow) {
    return { actual, goal: null, rag: null }
  }
  const ev = evaluateGoalRow(
    metricId,
    actual,
    goalVal,
    goalRow.goalType,
    goalRow.periodType,
    goalRow.periodStart
  )
  return { actual, goal: goalVal, rag: ev.rag }
}

type DaySlice = {
  date: string
  revenue: number
  cm3: number
  totalSpend: number
  mer: number | null
  newCustomers: number
  totalOrders: number
  acquisitionAdSpend: number
  ncRevenue: number
  aMer: number | null
  blendedCac: number | null
  aov: number | null
}

/** One calendar month + padding for week boundaries */
export const MAX_CALENDAR_DAYS = 40

export async function computeCalendarReport(
  prisma: PrismaClient,
  workspaceMetrics: WorkspaceForMetrics,
  workspaceAcquisition: WorkspaceForAcquisition,
  workspaceId: string,
  params: { from: string; to: string; granularity: 'day' | 'week' | 'month' },
  orderFilterSettings: OrderFilterSettings
): Promise<{ rows: CalendarReportRow[]; currency: string }> {
  const fromD = parseISO(`${params.from}T00:00:00.000Z`)
  const toD = parseISO(`${params.to}T00:00:00.000Z`)
  if (fromD > toD) return { rows: [], currency: 'INR' }

  const days = eachDayOfInterval({ start: fromD, end: toD })
  if (days.length > MAX_CALENDAR_DAYS) {
    throw new Error(`Range max ${MAX_CALENDAR_DAYS} days (use a single calendar month)`)
  }

  const [goals, actions, acqResult, batchedDays, klaviyoSends] = await Promise.all([
    prisma.workspaceMetricGoal.findMany({ where: { workspaceId } }),
    prisma.marketingAction.findMany({
      where: {
        workspaceId,
        actionDate: {
          gte: new Date(params.from + 'T00:00:00.000Z'),
          lte: new Date(params.to + 'T23:59:59.999Z'),
        },
      },
      orderBy: [{ actionDate: 'asc' }, { createdAt: 'asc' }],
    }),
    computeAcquisition(prisma, workspaceAcquisition, {
      from: params.from,
      to: params.to,
    }),
    computeCalendarDaySlicesBatched(prisma, workspaceMetrics, orderFilterSettings, params),
    prisma.emailPerformance.findMany({
      where: {
        workspaceId,
        sourceType: 'campaign',
        sendDate: {
          gte: new Date(params.from + 'T00:00:00.000Z'),
          lte: new Date(params.to + 'T23:59:59.999Z'),
        },
      },
    }),
  ])

  const acqByDate = new Map(acqResult.daily.map((d) => [d.date, d]))

  const daySlices: DaySlice[] = []
  let currency = batchedDays[0]?.currency ?? 'INR'

  for (const w of batchedDays) {
    const dateStr = w.date
    currency = w.currency
    const acq = acqByDate.get(dateStr)
    const mer = w.totalAdSpend > 0 ? w.netSales / w.totalAdSpend : null
    const orders = w.ordersCount
    daySlices.push({
      date: dateStr,
      revenue: w.netSales,
      cm3: w.cm3,
      totalSpend: w.totalAdSpend,
      mer,
      newCustomers: acq?.newCustomers ?? 0,
      totalOrders: orders,
      acquisitionAdSpend: acq?.acquisitionAdSpend ?? 0,
      ncRevenue: acq?.ncRevenue ?? 0,
      aMer: acq?.aMerDaily ?? null,
      blendedCac:
        acq && acq.newCustomers > 0 ? acq.adSpend / acq.newCustomers : null,
      aov: orders > 0 ? w.netSales / orders : null,
    })
  }

  const actionsByDate = new Map<string, typeof actions>()
  for (const a of actions) {
    const k = a.actionDate.toISOString().slice(0, 10)
    if (!actionsByDate.has(k)) actionsByDate.set(k, [])
    actionsByDate.get(k)!.push(a)
  }

  const klaviyoByDate = new Map<string, typeof klaviyoSends>()
  for (const e of klaviyoSends) {
    const k = e.sendDate.toISOString().slice(0, 10)
    if (!klaviyoByDate.has(k)) klaviyoByDate.set(k, [])
    klaviyoByDate.get(k)!.push(e)
  }

  function aggregateBucket(dates: string[]): {
    revenue: number
    cm3: number
    totalSpend: number
    mer: number | null
    amer: number | null
    newCustomers: number
    cac: number | null
    aov: number | null
  } {
    let revenue = 0,
      cm3 = 0,
      totalSpend = 0,
      nc = 0,
      orders = 0,
      acqSpend = 0,
      ncRev = 0
    for (const ds of dates) {
      const sl = daySlices.find((x) => x.date === ds)
      if (!sl) continue
      revenue += sl.revenue
      cm3 += sl.cm3
      totalSpend += sl.totalSpend
      nc += sl.newCustomers
      orders += sl.totalOrders
      acqSpend += sl.acquisitionAdSpend
      ncRev += sl.ncRevenue
    }
    const mer = totalSpend > 0 ? revenue / totalSpend : null
    const amer = acqSpend > 0 ? ncRev / acqSpend : null
    const cac = nc > 0 ? totalSpend / nc : null
    const aov = orders > 0 ? revenue / orders : null
    return { revenue, cm3, totalSpend, mer, amer, newCustomers: nc, cac, aov }
  }

  function buildRow(
    periodKey: string,
    label: string,
    dates: string[]
  ): CalendarReportRow {
    const agg = aggregateBucket(dates)
    const actList = dates.flatMap((ds) => {
      const manual = (actionsByDate.get(ds) ?? []).map((a) => ({
        id: a.id,
        actionDate: a.actionDate.toISOString().slice(0, 10),
        actionType: a.actionType,
        actionName: a.actionName,
        notes: a.notes,
        source: 'manual' as const,
      }))
      const klv = (klaviyoByDate.get(ds) ?? []).map((e) => ({
        id: `klaviyo-${e.id}`,
        actionDate: ds,
        actionType: e.channel === 'sms' ? 'sms_campaign' : 'email_campaign',
        actionName: e.name,
        notes: `Klaviyo · ${e.delivered} delivered · ${Number(e.revenue).toFixed(0)} rev`,
        source: 'klaviyo' as const,
      }))
      return [...manual, ...klv]
    })
    const uniqueActs = [...new Map(actList.map((x) => [x.id, x])).values()]

    const { sum: revGoalSum, hasAny: revG } = sumNumericGoalsForDates(
      'revenue',
      dates,
      goals
    )
    const { sum: cm3GoalSum, hasAny: cm3G } = sumNumericGoalsForDates('cm3', dates, goals)
    const { sum: ncGoalSum, hasAny: ncG } = sumNumericGoalsForDates(
      'new_customers',
      dates,
      goals
    )
    const { sum: aovGoalSum, hasAny: aovG } = sumNumericGoalsForDates('aov', dates, goals)

    const merRow = ratioGoalForPeriod('mer', dates, goals)
    const amerRow = ratioGoalForPeriod('amer', dates, goals)
    const cacRow = ratioGoalForPeriod('cac', dates, goals)
    const midD = dates[Math.floor(dates.length / 2)] ?? dates[0] ?? params.from

    return {
      periodKey,
      label,
      actions: uniqueActs,
      revenue: evalCell(
        'revenue',
        agg.revenue,
        revG ? revGoalSum : null,
        pickGoalRow('revenue', midD, goals)
      ),
      cm3: evalCell(
        'cm3',
        agg.cm3,
        cm3G ? cm3GoalSum : null,
        pickGoalRow('cm3', midD, goals)
      ),
      totalSpend: agg.totalSpend,
      mer: evalCell(
        'mer',
        agg.mer,
        merRow ? Number(merRow.goalValue) : null,
        merRow
      ),
      amer: evalCell(
        'amer',
        agg.amer,
        amerRow ? Number(amerRow.goalValue) : null,
        amerRow
      ),
      newCustomers: evalCell(
        'new_customers',
        agg.newCustomers,
        ncG ? ncGoalSum : null,
        pickGoalRow('new_customers', midD, goals)
      ),
      cac: evalCell(
        'cac',
        agg.cac,
        cacRow ? Number(cacRow.goalValue) : null,
        cacRow
      ),
      aov: evalCell(
        'aov',
        agg.aov,
        aovG ? aovGoalSum : null,
        pickGoalRow('aov', midD, goals)
      ),
    }
  }

  const rows: CalendarReportRow[] = []

  if (params.granularity === 'day') {
    for (const sl of daySlices) {
      rows.push(buildRow(sl.date, sl.date, [sl.date]))
    }
    return { rows, currency }
  }

  if (params.granularity === 'week') {
    const weekStarts = new Set<string>()
    for (const sl of daySlices) {
      const d0 = parseISO(`${sl.date}T12:00:00.000Z`)
      weekStarts.add(format(startOfWeek(d0, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
    }
    for (const wk of [...weekStarts].sort()) {
      const ws = parseISO(`${wk}T12:00:00.000Z`)
      const we = endOfWeek(ws, { weekStartsOn: 1 })
      const bucketDates = daySlices
        .filter((s) => {
          const dd = parseISO(`${s.date}T12:00:00.000Z`)
          return dd >= ws && dd <= we
        })
        .map((s) => s.date)
      rows.push(
        buildRow(
          `w-${wk}`,
          `${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`,
          bucketDates
        )
      )
    }
    return { rows, currency }
  }

  const byMonth = new Map<string, string[]>()
  for (const sl of daySlices) {
    const mk = sl.date.slice(0, 7)
    if (!byMonth.has(mk)) byMonth.set(mk, [])
    byMonth.get(mk)!.push(sl.date)
  }
  for (const [mk, dlist] of [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const d0 = parseISO(`${dlist[0]}T12:00:00.000Z`)
    rows.push(
      buildRow(
        `m-${mk}`,
        format(startOfMonth(d0), 'MMMM yyyy'),
        dlist
      )
    )
  }

  return { rows, currency }
}
