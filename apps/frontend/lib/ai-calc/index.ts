/**
 * AI Calculations Engine — barrel export + aggregator.
 * buildFullAiContext() calls all calculation modules and returns FullAiContext.
 * Date convention: dates are computed in IST (UTC+5:30) to match the analytics page.
 */
import type { PrismaClient } from '@prisma/client'
import type { FullAiContext, AiRecentOrder } from './types'
import { calcAnalytics } from './analytics'
import { calcPnl } from './pnl'
import { calcAds } from './ads'
import { calcOrders } from './orders'
import { calcCohorts } from './cohorts'
import { calcTimings } from './timings'
import { calcInventory } from './inventory'
import { getOrderInclusionWhereFromWorkspace } from '@/lib/order-filters'

export type { FullAiContext } from './types'
export type {
  AiAnalyticsData, AiDailyRow, AiAnalyticsSummary,
  AiPnlData, AiPnlSummary,
  AiAdsData, AiAdsSummary, AiAdCampaign,
  AiOrdersData, AiOrdersSummary,
  AiCohortsData, AiCohortsSummary,
  AiTimingsData, AiTimingsSummary,
  AiInventoryData, AiInventorySummary,
} from './types'

/**
 * Build the full AI context from live calculations.
 * @param days Number of days to look back (default 30). Dates computed in IST to match analytics page.
 */
export async function buildFullAiContext(
  prisma: PrismaClient,
  workspaceId: string,
  slug: string,
  days: number = 30,
): Promise<FullAiContext> {
  // Compute dates in IST (UTC+5:30) — the analytics page uses the browser's local (IST)
  // date, so we must match that to get identical results.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
  const nowIST = new Date(Date.now() + IST_OFFSET_MS)

  const toStr = nowIST.toISOString().slice(0, 10)          // YYYY-MM-DD in IST
  const fromIST = new Date(nowIST)
  fromIST.setUTCDate(fromIST.getUTCDate() - days + 1)
  const fromStr = fromIST.toISOString().slice(0, 10)        // YYYY-MM-DD in IST

  // Same T00:00:00.000Z / T23:59:59.999Z convention the analytics API route uses
  const from = new Date(fromStr + 'T00:00:00.000Z')
  const to = new Date(toStr + 'T23:59:59.999Z')

  // Load workspace with all connections
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
      cogsSettings: true,
      meta_ads_connections: {
        select: { id: true, selected_ad_account_ids: true, selected_ad_account_id: true },
      },
      google_ads_connections: {
        select: { id: true, selected_customer_ids: true, selected_customer_id: true },
      },
      shiprocketConnection: {
        select: { id: true, status: true },
      },
    },
  })

  const connectionId = workspace.shopifyConnections[0]?.id ?? ''

  const orderInclusionWhere = getOrderInclusionWhereFromWorkspace(workspace as any)

  // Run all calculations in parallel
  const [analytics, pnl, orders, cohorts, timings, inventory] = await Promise.all([
    calcAnalytics(prisma, workspaceId, connectionId, from, to, workspace),
    calcPnl(prisma, workspace as any, from, to),
    calcOrders(prisma, connectionId, workspaceId, from, to, orderInclusionWhere),
    connectionId ? calcCohorts(prisma, workspace as any, fromStr, toStr) : Promise.resolve(null),
    connectionId ? calcTimings(prisma, workspace as any, fromStr, toStr) : Promise.resolve(null),
    connectionId ? calcInventory(prisma, connectionId) : Promise.resolve(null),
  ])

  // Ads needs net sales from analytics
  const ads = await calcAds(
    prisma,
    workspace as any,
    from, to,
    analytics.summary.totalNetSales,
  )

  // Recent individual orders (last 25) for order-level AI queries
  const recentOrderRows = connectionId
    ? await prisma.shopifyOrder.findMany({
        where: { connectionId, processedAt: { gte: from, lte: to } },
        orderBy: { processedAt: 'desc' },
        take: 25,
        select: {
          name: true,
          orderNumber: true,
          processedAt: true,
          totalPrice: true,
          currency: true,
          financialStatus: true,
          fulfillmentStatus: true,
          customerShopifyId: true,
          email: true,
          _count: { select: { lineItems: true } },
        },
      })
    : []

  // Fetch customer names in one query
  const customerShopifyIds = recentOrderRows
    .map((o) => o.customerShopifyId)
    .filter((id): id is string => !!id)

  const customerMap = new Map<string, string>()
  if (customerShopifyIds.length > 0 && connectionId) {
    const customers = await prisma.shopifyCustomer.findMany({
      where: { connectionId, shopifyId: { in: customerShopifyIds } },
      select: { shopifyId: true, firstName: true, lastName: true },
    })
    for (const c of customers) {
      const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()
      if (name) customerMap.set(c.shopifyId, name)
    }
  }

  const recentOrders: AiRecentOrder[] = recentOrderRows.map((o) => ({
    orderNumber: o.name ?? String(o.orderNumber),
    processedAt: o.processedAt.toISOString().replace('T', ' ').slice(0, 16),
    customerName: o.customerShopifyId ? (customerMap.get(o.customerShopifyId) ?? null) : null,
    customerEmail: o.email ?? null,
    totalPrice: Number(o.totalPrice),
    financialStatus: o.financialStatus ?? null,
    fulfillmentStatus: o.fulfillmentStatus ?? null,
    itemCount: o._count.lineItems,
    currency: o.currency ?? 'INR',
  }))

  return {
    period: { from: fromStr, to: toStr, days },
    analytics,
    pnl,
    ads,
    orders,
    cohorts,
    timings,
    inventory,
    recentOrders,
  }
}
