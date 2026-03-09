/**
 * Central COGS resolution for the app.
 *
 * Single source of truth for:
 * - Override: when overrideAllCogsPercent > 0, COGS = (overridePct/100) × line revenue
 * - Fallback: when product COGS (coq) is missing and fallbackCogsPercent > 0, COGS = (fallbackPct/100) × line revenue
 * - Markup: optional cogsMarkupPercent applied on top of base COGS
 *
 * Base price for override/fallback:
 * - We use the line item's unit selling price (price) × quantity = revenue.
 * - This is the order-line's actual sold price in context, not product/variant list price.
 * - Stored in Shopify as ShopifyLineItem.price (unit price at time of order).
 */

export type CogsSettings = {
  overrideAllCogsPercent: number
  fallbackCogsPercent: number
  cogsMarkupPercent: number
}

export type LineItemForCogs = {
  price: number
  quantity: number
  productShopifyId: string | null
}

/** Normalize workspace/DB cogs settings to numbers. */
export function normalizeCogsSettings(
  raw: { overrideAllCogsPercent: unknown; fallbackCogsPercent: unknown; cogsMarkupPercent: unknown } | null
): CogsSettings {
  if (!raw) {
    return { overrideAllCogsPercent: 0, fallbackCogsPercent: 0, cogsMarkupPercent: 0 }
  }
  return {
    overrideAllCogsPercent: Number(raw.overrideAllCogsPercent) || 0,
    fallbackCogsPercent: Number(raw.fallbackCogsPercent) || 0,
    cogsMarkupPercent: Number(raw.cogsMarkupPercent) || 0,
  }
}

/**
 * Resolve effective COGS for a single line item.
 * - If override ON (overrideAllCogsPercent > 0): COGS = revenue × (overridePct/100), then apply markup.
 * - If override OFF: use product coq if set; else fallback % of revenue; else 0. Then apply markup.
 *
 * @param lineItem - Must include price (unit), quantity, productShopifyId
 * @param coqMap - Map of productShopifyId -> cost-of-goods (coq) per unit
 * @param settings - Normalized COGS settings (use normalizeCogsSettings if from DB)
 * @returns Effective COGS for this line (after markup if any)
 */
export function resolveLineItemCogs(
  lineItem: LineItemForCogs,
  coqMap: Map<string, number>,
  settings: CogsSettings
): number {
  const revenue = Number(lineItem.price) * lineItem.quantity
  const { overrideAllCogsPercent: overridePct, fallbackCogsPercent: fallbackPct, cogsMarkupPercent: markupPct } = settings

  let baseCogs: number
  if (overridePct > 0) {
    baseCogs = revenue * (overridePct / 100)
  } else {
    const coq = lineItem.productShopifyId ? coqMap.get(lineItem.productShopifyId) ?? 0 : 0
    if (coq > 0) {
      baseCogs = coq * lineItem.quantity
    } else if (fallbackPct > 0) {
      baseCogs = revenue * (fallbackPct / 100)
    } else {
      baseCogs = 0
    }
  }
  return markupPct > 0 ? baseCogs * (1 + markupPct / 100) : baseCogs
}

export type LineItemWithDate = LineItemForCogs & {
  /** Order processed date (for daily aggregation). */
  orderProcessedAt?: Date
}

export type ComputeLineItemsCogsOptions = {
  /** If set, log one sample line in development (e.g. page name for verification). */
  logSampleSource?: string
}

/**
 * Compute total COGS and optional daily breakdown from a list of line items.
 * Uses resolveLineItemCogs for each line. Optionally logs one sample in dev.
 */
export function computeLineItemsCogs(
  lineItems: LineItemWithDate[],
  coqMap: Map<string, number>,
  settings: CogsSettings,
  options?: ComputeLineItemsCogsOptions
): { totalCogs: number; dailyCogs: Map<string, number> } {
  const dailyCogs = new Map<string, number>()
  let totalCogs = 0
  let sampleLogged = false

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i]
    const cogs = resolveLineItemCogs(item, coqMap, settings)
    totalCogs += cogs
    if (item.orderProcessedAt) {
      const dateStr = item.orderProcessedAt.toISOString().slice(0, 10)
      dailyCogs.set(dateStr, (dailyCogs.get(dateStr) ?? 0) + cogs)
    }
    if (
      process.env.NODE_ENV === 'development' &&
      options?.logSampleSource &&
      !sampleLogged &&
      i === 0
    ) {
      const revenue = Number(item.price) * item.quantity
      const overrideOn = settings.overrideAllCogsPercent > 0
      console.log('[cogs/resolve] sample line', {
        source: options.logSampleSource,
        overrideEnabled: overrideOn,
        overridePercent: settings.overrideAllCogsPercent,
        basePriceUsed: Number(item.price),
        quantity: item.quantity,
        lineRevenue: Math.round(revenue * 100) / 100,
        resolvedCogs: Math.round(cogs * 100) / 100,
      })
      sampleLogged = true
    }
  }
  return { totalCogs, dailyCogs }
}

/**
 * Consistency check: same line item + settings should yield same COGS.
 * Call from tests or dev assertion. Returns true if resolution is deterministic.
 */
export function assertSameCogsForSameInput(
  lineItem: LineItemForCogs,
  coqMap: Map<string, number>,
  settings: CogsSettings
): boolean {
  const a = resolveLineItemCogs(lineItem, coqMap, settings)
  const b = resolveLineItemCogs(lineItem, coqMap, settings)
  if (a !== b) {
    throw new Error(`COGS resolution inconsistent: ${a} !== ${b}`)
  }
  return true
}
