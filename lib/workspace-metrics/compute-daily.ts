import type { PrismaClient } from '@prisma/client'
import { getDaysInMonth } from 'date-fns'
import { RTO_STATUS_CODES } from './constants'

export type WorkspaceForMetrics = {
  id: string
  shopifyConnections: { id: string }[]
  meta_ads_connections: {
    id: string
    selected_ad_account_ids: string[]
    selected_ad_account_id: string | null
  } | null
  google_ads_connections: {
    id: string
    selected_customer_ids: string[]
    selected_customer_id: string | null
  } | null
  shiprocketConnection: { id: string; status: string } | null
}

export type WorkspaceDailyMetricsRow = {
  workspaceId: string
  date: Date
  netSales: number
  grossSales: number
  totalTax: number
  totalDiscount: number
  ordersCount: number
  aov: number
  currency: string
  cogs: number
  shipping: number
  packaging: number
  websiteCharges: number
  cm1: number
  metaAdSpend: number
  googleAdSpend: number
  totalAdSpend: number
  cm2: number
  miscExpensesProrated: number
  cm3: number
  acos: number | null
  blendedRoas: number | null
  sessions: number | null
  conversionRate: number | null
  rtoOrders: number | null
  rtoValue: number | null
  rtoPercent: number | null
  rtoMapped: number | null
  rtoUnmapped: number | null
  totalShipments: number | null
  prepaidOrdersCount: number | null
  prepaidPercentage: number | null
}

/**
 * Compute all daily metrics for one workspace and one date.
 * Uses same logic as app/api/workspaces/[slug]/shopify-analytics (per-day slice).
 */
export async function computeWorkspaceDayMetrics(
  prisma: PrismaClient,
  workspace: WorkspaceForMetrics,
  date: Date
): Promise<WorkspaceDailyMetricsRow | null> {
  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) return null

  const dateStr = date.toISOString().slice(0, 10)
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`)
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`)

  const [dailyRow, workspaceCosts, miscExpenses] = await Promise.all([
    prisma.shopifyAnalyticsDaily.findUnique({
      where: {
        connectionId_date: { connectionId, date: dayStart },
      },
      select: {
        netSales: true,
        grossSales: true,
        totalTax: true,
        totalDiscount: true,
        ordersCount: true,
        aov: true,
        currency: true,
        sessions: true,
        conversionRate: true,
      },
    }),
    prisma.workspaceCost.findMany({
      where: {
        workspaceId: workspace.id,
        effectiveFrom: { lte: dayEnd },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: dayStart } },
        ],
      },
    }),
    prisma.workspaceMiscExpense.findMany({
      where: {
        workspaceId: workspace.id,
        effectiveStartDate: { lte: dayEnd },
      },
    }),
  ])

  const storeCurrency = dailyRow?.currency ?? 'INR'
  const netSales = dailyRow ? Number(dailyRow.netSales) : 0
  const grossSales = dailyRow ? Number(dailyRow.grossSales) : 0
  const totalTax = dailyRow ? Number(dailyRow.totalTax) : 0
  const totalDiscount = dailyRow ? Number(dailyRow.totalDiscount) : 0
  const ordersCount = dailyRow?.ordersCount ?? 0
  const aov = dailyRow ? Number(dailyRow.aov) : 0
  const sessions = dailyRow?.sessions ?? null
  const conversionRate = dailyRow?.conversionRate != null ? Number(dailyRow.conversionRate) : null

  const products = await prisma.shopifyProduct.findMany({
    where: { connectionId },
    select: { shopifyId: true, coq: true },
  })
  const coqMap = new Map<string, number>()
  for (const p of products) {
    if (p.coq) coqMap.set(p.shopifyId, Number(p.coq))
  }

  const lineItems = await prisma.shopifyLineItem.findMany({
    where: {
      connectionId,
      order: { processedAt: { gte: dayStart, lte: dayEnd } },
    },
    select: {
      productShopifyId: true,
      quantity: true,
    },
  })

  let cogs = 0
  for (const item of lineItems) {
    const coq = item.productShopifyId ? (coqMap.get(item.productShopifyId) ?? 0) : 0
    cogs += coq * item.quantity
  }

  let shipping = 0
  let packaging = 0
  let websiteCharges = 0
  for (const cost of workspaceCosts) {
    const costFromStr = cost.effectiveFrom.toISOString().slice(0, 10)
    const costToStr = cost.effectiveTo ? cost.effectiveTo.toISOString().slice(0, 10) : '9999-12-31'
    if (dateStr < costFromStr || dateStr > costToStr) continue
    const amount = Number(cost.amount)
    if (cost.costType === 'SHIPPING') {
      shipping += amount * ordersCount
    } else if (cost.costType === 'PACKAGING') {
      packaging += amount * ordersCount
    } else if (cost.costType === 'WEBSITE') {
      if (cost.isPercent) {
        websiteCharges += (amount / 100) * grossSales
      } else {
        websiteCharges += amount * ordersCount
      }
    }
  }

  const cm1 = netSales - cogs - shipping - packaging - websiteCharges

  const metaConn = workspace.meta_ads_connections
  const googleConn = workspace.google_ads_connections
  const metaSelectedIds =
    metaConn?.selected_ad_account_ids?.length
      ? metaConn.selected_ad_account_ids
      : metaConn?.selected_ad_account_id
        ? [metaConn.selected_ad_account_id]
        : undefined
  const googleSelectedIds =
    googleConn?.selected_customer_ids?.length
      ? googleConn.selected_customer_ids
      : googleConn?.selected_customer_id
        ? [googleConn.selected_customer_id]
        : undefined

  let metaAdSpend = 0
  let googleAdSpend = 0

  if (metaConn?.id) {
    const metaWhere: { connection_id: string; date: { gte: Date; lte: Date }; ad_account_id?: { in: string[] } } = {
      connection_id: metaConn.id,
      date: { gte: dayStart, lte: dayEnd },
    }
    if (metaSelectedIds?.length) metaWhere.ad_account_id = { in: metaSelectedIds }
    const metaAgg = await prisma.meta_ads_daily_metrics.aggregate({
      where: metaWhere,
      _sum: { spend: true },
    })
    metaAdSpend = Number(metaAgg._sum.spend ?? 0)
  }

  if (googleConn?.id) {
    const googleWhere: { connection_id: string; date: { gte: Date; lte: Date }; customer_id?: { in: string[] } } = {
      connection_id: googleConn.id,
      date: { gte: dayStart, lte: dayEnd },
    }
    if (googleSelectedIds?.length) googleWhere.customer_id = { in: googleSelectedIds }
    const googleAgg = await prisma.google_ads_daily_metrics.aggregate({
      where: googleWhere,
      _sum: { spend: true },
    })
    googleAdSpend = Number(googleAgg._sum.spend ?? 0)
  }

  const totalAdSpend = metaAdSpend + googleAdSpend
  const cm2 = cm1 - totalAdSpend

  let miscExpensesProrated = 0
  const dateAtNoonUtc = new Date(`${dateStr}T12:00:00.000Z`)
  const daysInMonth = getDaysInMonth(dateAtNoonUtc)
  for (const e of miscExpenses) {
    const startDateStr = e.effectiveStartDate.toISOString().slice(0, 10)
    if (dateStr < startDateStr) continue
    const monthlyAmt = Number(e.amount)
    miscExpensesProrated += monthlyAmt / daysInMonth
  }
  const cm3 = cm2 - miscExpensesProrated

  const acos = netSales > 0 ? Math.round((totalAdSpend / netSales) * 10000) / 100 : null
  const blendedRoas = totalAdSpend > 0 ? Math.round((netSales / totalAdSpend) * 100) / 100 : null

  let rtoOrders: number | null = null
  let rtoValue: number | null = null
  let rtoPercent: number | null = null
  let rtoMapped: number | null = null
  let rtoUnmapped: number | null = null
  let totalShipments: number | null = null

  const srConn = workspace.shiprocketConnection
  if (srConn?.status === 'CONNECTED') {
    const allShipments = await prisma.shiprocketShipment.findMany({
      where: {
        connectionId: srConn.id,
        shippedAt: { gte: dayStart, lte: dayEnd },
      },
      select: {
        trackingStatusCode: true,
        statusCode: true,
        channelOrderId: true,
      },
    })
    totalShipments = allShipments.length
    const rtoShipments = allShipments.filter((s) => {
      const code = s.trackingStatusCode ?? s.statusCode
      return code != null && RTO_STATUS_CODES.includes(code)
    })
    rtoOrders = rtoShipments.length
    rtoPercent = totalShipments > 0 ? Math.round((rtoOrders / totalShipments) * 10000) / 100 : null

    const channelIds = rtoShipments
      .map((s) => s.channelOrderId)
      .filter((id): id is string => id != null && id !== '')
    if (channelIds.length > 0) {
      const cleanIds = channelIds.map((id) => id.replace(/^#/, ''))
      const matchedOrders = await prisma.shopifyOrder.findMany({
        where: {
          connectionId,
          OR: [
            { orderNumber: { in: cleanIds } },
            { name: { in: channelIds } },
          ],
        },
        select: { totalPrice: true },
      })
      rtoValue = matchedOrders.reduce((sum, o) => sum + Number(o.totalPrice), 0)
      rtoMapped = matchedOrders.length
      rtoUnmapped = rtoOrders - rtoMapped
    } else {
      rtoUnmapped = rtoOrders
    }
  }

  let prepaidOrdersCount: number | null = null
  let prepaidPercentage: number | null = null
  const orderCounts = await prisma.shopifyOrder.groupBy({
    by: ['financialStatus'],
    where: {
      connectionId,
      processedAt: { gte: dayStart, lte: dayEnd },
    },
    _count: { id: true },
  })
  let prepaid = 0
  let total = 0
  for (const g of orderCounts) {
    total += g._count.id
    if (g.financialStatus?.toLowerCase() === 'paid') prepaid += g._count.id
  }
  if (total > 0) {
    prepaidOrdersCount = prepaid
    prepaidPercentage = Math.round((prepaid / total) * 10000) / 100
  }

  return {
    workspaceId: workspace.id,
    date: dayStart,
    netSales,
    grossSales,
    totalTax,
    totalDiscount,
    ordersCount,
    aov,
    currency: storeCurrency,
    cogs,
    shipping,
    packaging,
    websiteCharges,
    cm1,
    metaAdSpend,
    googleAdSpend,
    totalAdSpend,
    cm2,
    miscExpensesProrated,
    cm3,
    acos,
    blendedRoas,
    sessions,
    conversionRate,
    rtoOrders,
    rtoValue,
    rtoPercent,
    rtoMapped,
    rtoUnmapped,
    totalShipments,
    prepaidOrdersCount,
    prepaidPercentage,
  }
}
