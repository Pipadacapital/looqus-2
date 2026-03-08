import type { PrismaClient } from '@prisma/client'
import { Prisma, type Prisma } from '@prisma/client'

/**
 * Workspace-level settings for excluding Shopify orders from analytics.
 * Defaults: include all orders (empty skipped tags, do not skip zero sales).
 */
export type OrderFilterSettings = {
  skippedShopifyOrderTags: string[]
  skipZeroSalesOrders: boolean
}

const DEFAULT_SETTINGS: OrderFilterSettings = {
  skippedShopifyOrderTags: [],
  skipZeroSalesOrders: false,
}

export function normalizeOrderFilterSettings(
  raw: Partial<OrderFilterSettings> | null | undefined
): OrderFilterSettings {
  if (!raw) return DEFAULT_SETTINGS
  const tags = Array.isArray(raw.skippedShopifyOrderTags)
    ? raw.skippedShopifyOrderTags.filter((t): t is string => typeof t === 'string')
    : []
  const skipZero = Boolean(raw.skipZeroSalesOrders)
  return { skippedShopifyOrderTags: tags, skipZeroSalesOrders: skipZero }
}

/**
 * Returns true if no orders are excluded (include-all behavior).
 */
export function hasNoOrderFilters(settings: OrderFilterSettings): boolean {
  return (
    settings.skippedShopifyOrderTags.length === 0 && !settings.skipZeroSalesOrders
  )
}

/**
 * Prisma where clause for ShopifyOrder: only orders that should be INCLUDED in analytics.
 * Excluded: (1) order has any tag in skippedShopifyOrderTags, or (2) skipZeroSalesOrders and totalPrice <= 0.
 * So we keep orders where: NOT (tags has any skipped) AND (NOT skipZero OR totalPrice > 0).
 */
export function getOrderInclusionWhere(
  settings: OrderFilterSettings
): Prisma.ShopifyOrderWhereInput {
  const { skippedShopifyOrderTags, skipZeroSalesOrders } = settings
  const conditions: Prisma.ShopifyOrderWhereInput[] = []

  if (skippedShopifyOrderTags.length > 0) {
    conditions.push({
      NOT: { tags: { hasSome: skippedShopifyOrderTags } },
    })
  }
  if (skipZeroSalesOrders) {
    conditions.push({ totalPrice: { gt: 0 } })
  }
  if (conditions.length === 0) return {}
  if (conditions.length === 1) return conditions[0]
  return { AND: conditions }
}

/**
 * Merge workspace slug fetch with order filter settings for use in APIs.
 * Use this to extend an existing workspace where clause when you need to filter orders.
 */
export function getOrderInclusionWhereFromWorkspace(workspace: {
  skippedShopifyOrderTags?: string[] | null
  skipZeroSalesOrders?: boolean | null
}): Prisma.ShopifyOrderWhereInput {
  return getOrderInclusionWhere(
    normalizeOrderFilterSettings({
      skippedShopifyOrderTags: workspace.skippedShopifyOrderTags ?? [],
      skipZeroSalesOrders: workspace.skipZeroSalesOrders ?? false,
    })
  )
}

export type FilteredDailyRow = { grossSales: number; ordersCount: number }

/**
 * When workspace has order filters, aggregate gross sales and order count from orders
 * (by day) so analytics can use filtered totals instead of shopifyAnalyticsDaily.
 */
export async function getFilteredDailyAggregates(
  prisma: PrismaClient,
  connectionId: string,
  fromDate: Date,
  toDate: Date,
  settings: OrderFilterSettings
): Promise<Map<string, FilteredDailyRow>> {
  if (hasNoOrderFilters(settings)) return new Map()
  const inclusionWhere = getOrderInclusionWhere(settings)
  const orders = await prisma.shopifyOrder.findMany({
    where: {
      connectionId,
      processedAt: { gte: fromDate, lte: toDate },
      ...inclusionWhere,
    },
    select: { processedAt: true, totalPrice: true },
  })
  const byDate = new Map<string, FilteredDailyRow>()
  for (const o of orders) {
    const dateStr = o.processedAt.toISOString().slice(0, 10)
    const cur = byDate.get(dateStr) ?? { grossSales: 0, ordersCount: 0 }
    cur.grossSales += Number(o.totalPrice)
    cur.ordersCount += 1
    byDate.set(dateStr, cur)
  }
  return byDate
}

/**
 * Raw SQL fragment for use in $queryRaw: AND conditions so that only included orders are considered.
 * Use with table alias e.g. "o" for shopify_orders.
 * When no filters, returns Prisma.empty (no-op).
 */
export function getOrderInclusionRawFragment(
  settings: OrderFilterSettings,
  tableAlias: string
): Prisma.Sql {
  if (hasNoOrderFilters(settings)) return Prisma.sql``
  const { skippedShopifyOrderTags, skipZeroSalesOrders } = settings
  const tagsCol = Prisma.raw(`${tableAlias}.tags`)
  const totalPriceCol = Prisma.raw(`${tableAlias}.total_price`)
  const noTagMatch =
    skippedShopifyOrderTags.length === 0
      ? Prisma.sql`true`
      : Prisma.sql`NOT (${tagsCol} && ${skippedShopifyOrderTags}::text[])`
  const notZeroSales = skipZeroSalesOrders
    ? Prisma.sql`${totalPriceCol} > 0`
    : Prisma.sql`true`
  return Prisma.sql`AND (${noTagMatch}) AND (${notZeroSales})`
}
