import { Prisma, PrismaClient } from '@prisma/client'


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

type OrderFilterSettingsInput = Partial<OrderFilterSettings> & {
  skipped_shopify_order_tags?: string[] | null
  skip_zero_sales_orders?: boolean | null
}

export function normalizeOrderFilterSettings(
  raw: OrderFilterSettingsInput | null | undefined
): OrderFilterSettings {
  if (!raw) return DEFAULT_SETTINGS
  const fromCamel = raw.skippedShopifyOrderTags
  const fromSnake = raw.skipped_shopify_order_tags
  const tagSource = Array.isArray(fromCamel)
    ? fromCamel
    : Array.isArray(fromSnake)
      ? fromSnake
      : []
  const tags = tagSource.filter((t): t is string => typeof t === 'string')
  const skipZero = Boolean(
    raw.skipZeroSalesOrders ?? raw.skip_zero_sales_orders
  )
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

  // Include orders with null/empty tags or with no skipped tag (avoids Prisma error when tags is null in DB).
  if (skippedShopifyOrderTags.length > 0) {
    conditions.push({
      OR: [
        { tags: { equals: null } },
        { tags: { equals: [] } },
        { NOT: { tags: { hasSome: skippedShopifyOrderTags } } },
      ],
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
export function getOrderInclusionWhereFromWorkspace(
  workspace: OrderFilterSettingsInput
): Prisma.ShopifyOrderWhereInput {
  return getOrderInclusionWhere(normalizeOrderFilterSettings(workspace))
}

/**
 * Extract WooCommerce `order_type` from order payload.
 * Source of truth:
 * - top-level `order_type` / `orderType`
 * - `meta_data[].key === "order_type"`
 */
export function extractWoocommerceOrderType(rawJson: unknown): string | null {
  if (!rawJson || typeof rawJson !== 'object') return null
  const obj = rawJson as Record<string, unknown>

  const normalizeValue = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const v = normalizeValue(item)
        if (v) return v
      }
      return null
    }
    if (value && typeof value === 'object') {
      const rec = value as Record<string, unknown>
      for (const key of ['value', 'name', 'label', 'slug', 'title']) {
        const v = normalizeValue(rec[key])
        if (v) return v
      }
    }
    return null
  }

  // 1) Top-level key.
  for (const key of ['order_type', 'orderType']) {
    const value = obj[key]
    const normalized = normalizeValue(value)
    if (normalized) return normalized
  }

  // 2) Meta key in Woo order payload.
  const metaData = obj.meta_data
  if (Array.isArray(metaData)) {
    for (const item of metaData) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      const key = typeof entry.key === 'string' ? entry.key.trim().toLowerCase() : ''
      if (key === 'order_type') {
        const normalized = normalizeValue(entry.value)
        if (normalized) return normalized
      }
    }
  }
  return null
}

/** Resolved display value for Woo order type: DB column first, then raw_json. */
export function resolveWoocommerceOrderType(order: {
  orderType?: string | null
  rawJson?: unknown
}): string | null {
  const col =
    typeof order.orderType === 'string' ? order.orderType.trim() : ''
  if (col.length > 0) return col
  return extractWoocommerceOrderType(order.rawJson ?? null)
}

/**
 * Whether a WooCommerce order should be included in analytics for this workspace.
 * Skipped "tags" list holds order_type values for Woo (same setting as Shopify tags).
 */
export function isWoocommerceOrderIncluded(
  order: { orderType?: string | null; rawJson?: unknown; total?: unknown },
  settings: OrderFilterSettings
): boolean {
  const totalNum = Number(order.total ?? 0)
  if (settings.skipZeroSalesOrders && totalNum <= 0) return false
  if (settings.skippedShopifyOrderTags.length === 0) return true
  const resolved = resolveWoocommerceOrderType({
    orderType: order.orderType,
    rawJson: order.rawJson,
  })
  if (!resolved) return true
  const skip = new Set(
    settings.skippedShopifyOrderTags.map((t) => t.trim().toLowerCase())
  )
  return !skip.has(resolved.trim().toLowerCase())
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
      : Prisma.sql`(${tagsCol} IS NULL OR ${tagsCol} = '{}' OR NOT (${tagsCol} && ${skippedShopifyOrderTags}::text[]))`
  const notZeroSales = skipZeroSalesOrders
    ? Prisma.sql`${totalPriceCol} > 0`
    : Prisma.sql`true`
  return Prisma.sql`AND (${noTagMatch}) AND (${notZeroSales})`
}
