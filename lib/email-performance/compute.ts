/**
 * Email / SMS performance aggregates (Klaviyo-synced rows).
 *
 * Formulas (explicit):
 * - open_rate = unique_opens / delivered  (0 if delivered = 0)
 * - click_rate = unique_clicks / delivered
 * - email_revenue = sum(revenue) for row / group
 * - revenue_per_recipient = revenue / delivered
 * - revenue_per_unique_open = revenue / unique_opens  (0 if unique_opens = 0)
 * - unsubscribe_rate = unsubscribes / delivered
 * - spam_rate = spam_complaints / delivered
 */
import type { PrismaClient } from '@prisma/client'
import { format, getDay, parseISO } from 'date-fns'

export type EmailPerfGroupBy = 'campaign' | 'flow' | 'date' | 'channel' | 'dow'

export type EmailPerfAggregateRow = {
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

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function finalize(
  key: string,
  label: string,
  delivered: number,
  uniqueOpens: number,
  uniqueClicks: number,
  orders: number,
  revenue: number,
  unsubscribes: number,
  spamComplaints: number
): EmailPerfAggregateRow {
  const d = Math.max(0, delivered)
  const o = Math.max(0, uniqueOpens)
  return {
    key,
    label,
    delivered: d,
    uniqueOpens: o,
    uniqueClicks: uniqueClicks,
    orders,
    revenue,
    unsubscribes,
    spamComplaints,
    openRate: d > 0 ? o / d : 0,
    clickRate: d > 0 ? uniqueClicks / d : 0,
    revenuePerRecipient: d > 0 ? revenue / d : 0,
    revenuePerUniqueOpen: o > 0 ? revenue / o : 0,
    unsubscribeRate: d > 0 ? unsubscribes / d : 0,
    spamRate: d > 0 ? spamComplaints / d : 0,
  }
}

export async function aggregateEmailPerformance(
  prisma: PrismaClient,
  workspaceId: string,
  params: { from: string; to: string; groupBy: EmailPerfGroupBy }
): Promise<EmailPerfAggregateRow[]> {
  const fromD = new Date(params.from + 'T00:00:00.000Z')
  const toD = new Date(params.to + 'T23:59:59.999Z')

  const rows = await prisma.emailPerformance.findMany({
    where: {
      workspaceId,
      sendDate: { gte: fromD, lte: toD },
    },
    orderBy: { sendDate: 'desc' },
  })

  type Acc = {
    delivered: number
    uniqueOpens: number
    uniqueClicks: number
    orders: number
    revenue: number
    unsubscribes: number
    spamComplaints: number
    label: string
  }
  const map = new Map<string, Acc>()

  function add(
    key: string,
    label: string,
    r: (typeof rows)[0]
  ) {
    const cur = map.get(key) ?? {
      delivered: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
      orders: 0,
      revenue: 0,
      unsubscribes: 0,
      spamComplaints: 0,
      label,
    }
    cur.delivered += r.delivered
    cur.uniqueOpens += r.uniqueOpens
    cur.uniqueClicks += r.uniqueClicks
    cur.orders += r.orders
    cur.revenue += Number(r.revenue)
    cur.unsubscribes += r.unsubscribes
    cur.spamComplaints += r.spamComplaints
    if (r.name.length > cur.label.length) cur.label = r.name
    map.set(key, cur)
  }

  for (const r of rows) {
    const dateStr = r.sendDate.toISOString().slice(0, 10)
    if (params.groupBy === 'campaign' && r.sourceType === 'campaign') {
      add(`c:${r.klaviyoResourceId}`, r.name, r)
    } else if (params.groupBy === 'flow' && r.sourceType === 'flow') {
      const parts = r.klaviyoResourceId.split(':')
      const flowId = parts.length >= 3 ? parts[1]! : r.klaviyoResourceId
      add(`f:${flowId}`, r.name, r)
    } else if (params.groupBy === 'date') {
      add(`d:${dateStr}`, dateStr, r)
    } else if (params.groupBy === 'channel') {
      add(`ch:${r.channel}`, r.channel.toUpperCase(), r)
    } else if (params.groupBy === 'dow') {
      const dow = getDay(parseISO(dateStr + 'T12:00:00.000Z'))
      add(`w:${dow}`, DOW[dow] ?? String(dow), r)
    }
  }

  const out: EmailPerfAggregateRow[] = []
  for (const [key, acc] of map) {
    out.push(
      finalize(
        key,
        acc.label,
        acc.delivered,
        acc.uniqueOpens,
        acc.uniqueClicks,
        acc.orders,
        acc.revenue,
        acc.unsubscribes,
        acc.spamComplaints
      )
    )
  }

  if (params.groupBy === 'dow') {
    out.sort((a, b) => Number(a.key.split(':')[1] ?? 0) - Number(b.key.split(':')[1] ?? 0))
  } else {
    out.sort((a, b) => b.revenue - a.revenue || b.delivered - a.delivered)
  }
  return out
}
