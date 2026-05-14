/**
 * Batched daily commerce + CM3 chain for calendar report.
 * Uses same net revenue semantics as fetchStoreNetRevenueForPeriod (gap-fill + filtered refund share).
 * Avoids N× per-day DB round-trips.
 */
import type { PrismaClient } from '@prisma/client'
import { eachDayOfInterval, format, getDaysInMonth, parseISO } from 'date-fns'
import { getEffectiveDailyAggregates } from '@/lib/effective-daily'
import {
  getOrderInclusionWhere,
  hasNoOrderFilters,
  type OrderFilterSettings,
} from '@/lib/order-filters'
import { resolveLineItemCogs, normalizeCogsSettings } from '@/lib/cogs'
import { getDailyVariableContribution } from '@/lib/workspace-costs'
import { fetchAdSpendMapsWithClassification } from '@/lib/metrics/ads-spend'
import type { WorkspaceForMetrics } from '@/lib/workspace-metrics/compute-daily'

export type CalendarDayMetricSlice = {
  date: string
  netSales: number
  grossSales: number
  ordersCount: number
  cm3: number
  totalAdSpend: number
  currency: string
}

async function loadCommerceByDate(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  orderFilterSettings: OrderFilterSettings
): Promise<{
  byDate: Map<string, { netSales: number; grossSales: number; ordersCount: number }>
  currency: string
}> {
  const orderInclusionWhere = getOrderInclusionWhere(orderFilterSettings)
  const [analyticsRows, orders] = await Promise.all([
    prisma.shopifyAnalyticsDaily.findMany({
      where: { connectionId, date: { gte: fromDate, lte: toDate } },
      select: {
        date: true,
        netSales: true,
        grossSales: true,
        ordersCount: true,
        currency: true,
      },
    }),
    prisma.shopifyOrder.findMany({
      where: {
        connectionId,
        processedAt: { gte: fromDate, lte: toDate },
        cancelledAt: null,
        ...orderInclusionWhere,
      },
      select: { processedAt: true, totalPrice: true, totalTax: true },
    }),
  ])

  const analyticsByDate = new Map<
    string,
    { netSales: number; grossSales: number; ordersCount: number; currency: string | null }
  >()
  let currency = 'INR'
  for (const r of analyticsRows) {
    const ds = r.date.toISOString().slice(0, 10)
    analyticsByDate.set(ds, {
      netSales: Number(r.netSales),
      grossSales: Number(r.grossSales),
      ordersCount: r.ordersCount,
      currency: r.currency,
    })
    if (r.currency) currency = r.currency
  }

  const byDate = new Map<string, { netSales: number; grossSales: number; ordersCount: number }>()

  if (hasNoOrderFilters(orderFilterSettings)) {
    const orderNet = new Map<string, number>()
    const orderGross = new Map<string, number>()
    const orderCount = new Map<string, number>()
    for (const o of orders) {
      const ds = o.processedAt.toISOString().slice(0, 10)
      orderNet.set(ds, (orderNet.get(ds) ?? 0) + Number(o.totalPrice) - Number(o.totalTax ?? 0))
      orderGross.set(ds, (orderGross.get(ds) ?? 0) + Number(o.totalPrice))
      orderCount.set(ds, (orderCount.get(ds) ?? 0) + 1)
    }
    const allKeys = new Set<string>([...analyticsByDate.keys(), ...orderNet.keys()])
    for (const ds of allKeys) {
      const an = analyticsByDate.get(ds)
      const on = orderNet.get(ds) ?? 0
      const og = orderGross.get(ds) ?? 0
      const oc = orderCount.get(ds) ?? 0
      if (!an) {
        byDate.set(ds, { netSales: on, grossSales: og, ordersCount: oc })
      } else {
        const anNet = an.netSales
        if (anNet === 0 && on > 0) {
          byDate.set(ds, { netSales: on, grossSales: og, ordersCount: oc })
        } else {
          byDate.set(ds, {
            netSales: anNet,
            grossSales: an.grossSales,
            ordersCount: an.ordersCount,
          })
        }
      }
    }
    return { byDate, currency }
  }

  const effective = await getEffectiveDailyAggregates(
    prisma,
    connectionId,
    fromDate,
    toDate,
    orderInclusionWhere
  )
  for (const o of orders) {
    const ds = o.processedAt.toISOString().slice(0, 10)
    const day = effective.get(ds)
    const tp = Number(o.totalPrice)
    const tax = Number(o.totalTax ?? 0)
    const gross = day?.grossSales ?? 0
    const ret = day?.totalReturns ?? 0
    const share = gross > 0 ? (tp / gross) * ret : 0
    const net = tp - tax - share
    const cur = byDate.get(ds) ?? { netSales: 0, grossSales: 0, ordersCount: 0 }
    cur.netSales += net
    cur.grossSales += tp
    cur.ordersCount += 1
    byDate.set(ds, cur)
  }
  return { byDate, currency }
}

export async function computeCalendarDaySlicesBatched(
  prisma: PrismaClient,
  workspace: WorkspaceForMetrics,
  orderFilterSettings: OrderFilterSettings,
  params: { from: string; to: string }
): Promise<CalendarDayMetricSlice[]> {
  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) return []

  const fromD = parseISO(`${params.from}T00:00:00.000Z`)
  const toD = parseISO(`${params.to}T23:59:59.999Z`)
  const days = eachDayOfInterval({ start: fromD, end: toD })
  const orderInclusionWhere = getOrderInclusionWhere(orderFilterSettings)

  const [
    { byDate: commerceByDate, currency },
    products,
    lineItems,
    workspaceCosts,
    miscExpenses,
    adMaps,
  ] = await Promise.all([
    loadCommerceByDate(prisma, connectionId, fromD, toD, orderFilterSettings),
    prisma.shopifyProduct.findMany({
      where: { connectionId },
      select: { shopifyId: true, coq: true },
    }),
    prisma.shopifyLineItem.findMany({
      where: {
        connectionId,
        order: {
          processedAt: { gte: fromD, lte: toD },
          cancelledAt: null,
          ...orderInclusionWhere,
        },
      },
      select: {
        productShopifyId: true,
        quantity: true,
        price: true,
        order: { select: { processedAt: true } },
      },
    }),
    prisma.workspaceCost.findMany({
      where: {
        workspaceId: workspace.id,
        effectiveFrom: { lte: toD },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: fromD } }],
      },
    }),
    prisma.workspaceMiscExpense.findMany({
      where: {
        workspaceId: workspace.id,
        effectiveStartDate: { lte: toD },
      },
    }),
    fetchAdSpendMapsWithClassification(prisma, workspace.id, workspace, fromD, toD),
  ])

  const coqMap = new Map<string, number>()
  for (const p of products) {
    if (p.coq) coqMap.set(p.shopifyId, Number(p.coq))
  }
  const cogsSettings = normalizeCogsSettings(workspace.cogsSettings as any)

  const cogsByDate = new Map<string, number>()
  for (const item of lineItems) {
    const ds = item.order.processedAt.toISOString().slice(0, 10)
    const cogs = resolveLineItemCogs(
      {
        price: Number(item.price),
        quantity: Number(item.quantity),
        productShopifyId: item.productShopifyId,
      },
      coqMap,
      cogsSettings
    )
    cogsByDate.set(ds, (cogsByDate.get(ds) ?? 0) + cogs)
  }

  const slices: CalendarDayMetricSlice[] = []

  for (const day of days) {
    const dateStr = format(day, 'yyyy-MM-dd')

    const c = commerceByDate.get(dateStr) ?? {
      netSales: 0,
      grossSales: 0,
      ordersCount: 0,
    }
    const netSales = c.netSales
    const grossSales = c.grossSales
    const ordersCount = c.ordersCount
    const cogs = cogsByDate.get(dateStr) ?? 0

    let shipping = 0
    let packaging = 0
    let websiteCharges = 0
    for (const cost of workspaceCosts) {
      const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
      const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
      if (dateStr < costFromStr || dateStr > costToStr) continue
      const contribution = getDailyVariableContribution(
        {
          costType: cost.costType,
          amount: Number(cost.amount),
          currency: cost.currency,
          isPercent: cost.isPercent,
          billingMode: cost.billingMode ?? 'monthly',
        },
        dateStr,
        ordersCount,
        grossSales,
        currency
      )
      if (cost.costType === 'SHIPPING') shipping += contribution
      else if (cost.costType === 'PACKAGING') packaging += contribution
      else if (cost.costType === 'WEBSITE') websiteCharges += contribution
    }

    const cm1 = netSales - cogs - shipping - packaging - websiteCharges
    const totalAdSpend = adMaps.byDate.get(dateStr) ?? 0
    const cm2 = cm1 - totalAdSpend

    const dateAtNoonUtc = new Date(`${dateStr}T12:00:00.000Z`)
    const daysInMonth = getDaysInMonth(dateAtNoonUtc)
    let miscExpensesProrated = 0
    for (const e of miscExpenses) {
      const startDateStr = e.effectiveStartDate.toISOString().slice(0, 10)
      if (dateStr < startDateStr) continue
      miscExpensesProrated += Number(e.amount) / daysInMonth
    }
    const cm3 = cm2 - miscExpensesProrated

    slices.push({
      date: dateStr,
      netSales,
      grossSales,
      ordersCount,
      cm3,
      totalAdSpend,
      currency,
    })
  }

  return slices
}
