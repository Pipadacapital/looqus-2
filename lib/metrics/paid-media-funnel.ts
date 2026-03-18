/**
 * Paid media funnel metrics — shared shape for Meta (pixel) and Google (purchase-only).
 *
 * ## Meta (coverage: meta_full)
 * - **ATC / CI** parsed from synced insight `raw_json.actions` (Facebook pixel & common variants).
 * - **Purchases** = stored `conversions` (offsite_conversion.fb_pixel_purchase) — matches Performance ROAS.
 * - **Attributed revenue** = stored purchase conversion value (`revenue` on Meta rows).
 *
 * ## Google
 * - **google_purchase_only**: No staged rows — purchases = aggregate conversions, revenue = aggregate value.
 * - **google_full**: Staged rows from `google_ads_funnel_daily` (GAQL by `conversion_action`) —
 *   same rate formulas as Meta where counts exist.
 *
 * ## Formulas (aligned with existing CTR/CVR in app)
 * - **CTR** = 100 × clicks / impressions (impressions > 0)
 * - **ATC rate** = 100 × addToCart / clicks (clicks > 0); can exceed 100% when attributed ATC > link clicks
 * - **CI% of ATC** = 100 × checkoutInitiated / addToCart (addToCart > 0)
 * - **Purchase% of checkout** = 100 × purchases / checkoutInitiated (checkoutInitiated > 0)
 * - **Overall CVR** = 100 × purchases / clicks (clicks > 0) — same spirit as conversions/clicks
 * - **Cost per ATC** = spend / addToCart; **Cost per CI** = spend / checkoutInitiated; **Cost per purchase** = spend / purchases
 * - **ROAS** = attributedRevenue / spend (spend > 0)
 *
 * ## Benchmark bands (heuristic, not industry-calibrated)
 * Used for simple low / medium / strong UI tinting only.
 */

export type FunnelBand = 'low' | 'medium' | 'strong' | 'na'

export type PaidMediaFunnelCoverage = 'meta_full' | 'google_purchase_only' | 'google_full'

function isStagedFunnelCoverage(c: PaidMediaFunnelCoverage): boolean {
  return c === 'meta_full' || c === 'google_full'
}

/** Action types summed for Meta add-to-cart (deterministic list). */
const META_ATC_TYPES = new Set([
  'offsite_conversion.fb_pixel_add_to_cart',
  'add_to_cart',
  'onsite_conversion.add_to_cart',
  'omni_add_to_cart',
])

const META_IC_TYPES = new Set([
  'offsite_conversion.fb_pixel_initiate_checkout',
  'initiate_checkout',
  'onsite_conversion.initiate_checkout',
  'omni_initiate_checkout',
])

export type FunnelTotalsInput = {
  impressions: number
  clicks: number
  spend: number
  addToCart: number | null
  checkoutInitiated: number | null
  purchases: number
  attributedRevenue: number
  coverage: PaidMediaFunnelCoverage
}

export type PaidMediaFunnelSnapshot = FunnelTotalsInput & {
  ctrPct: number
  atcRatePct: number | null
  checkoutPerAtcPct: number | null
  purchasePerCheckoutPct: number | null
  overallCvrPct: number
  costPerAtc: number | null
  costPerCheckout: number | null
  costPerPurchase: number | null
  roas: number
}

export type FunnelDiagnostics = {
  atcRate: FunnelBand
  checkoutFromAtc: FunnelBand
  purchaseFromCheckout: FunnelBand
  clickToPurchase: FunnelBand
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function tier3(ratePct: number | null, low: number, high: number): FunnelBand {
  if (ratePct == null || Number.isNaN(ratePct)) return 'na'
  if (ratePct < low) return 'low'
  if (ratePct < high) return 'medium'
  return 'strong'
}

/**
 * Parse Meta Insights API row `actions` for pixel ATC + initiate checkout counts.
 */
export function parseMetaFunnelActionsFromRaw(raw: unknown): {
  addToCart: number
  checkoutInitiated: number
} {
  if (!raw || typeof raw !== 'object') return { addToCart: 0, checkoutInitiated: 0 }
  const actions = (raw as { actions?: { action_type?: string; value?: string }[] }).actions
  if (!Array.isArray(actions)) return { addToCart: 0, checkoutInitiated: 0 }
  let addToCart = 0
  let checkoutInitiated = 0
  for (const a of actions) {
    const t = a.action_type ?? ''
    const v = parseFloat(String(a.value ?? '0')) || 0
    if (META_ATC_TYPES.has(t)) addToCart += v
    if (META_IC_TYPES.has(t)) checkoutInitiated += v
  }
  return { addToCart, checkoutInitiated }
}

export function computePaidMediaFunnel(input: FunnelTotalsInput): PaidMediaFunnelSnapshot {
  const { impressions, clicks, spend, addToCart, checkoutInitiated, purchases, attributedRevenue, coverage } =
    input

  const ctrPct = impressions > 0 ? round2((100 * clicks) / impressions) : 0
  const atcRatePct =
    isStagedFunnelCoverage(coverage) && addToCart != null && clicks > 0
      ? round2((100 * addToCart) / clicks)
      : null
  const checkoutPerAtcPct =
    isStagedFunnelCoverage(coverage) &&
    addToCart != null &&
    checkoutInitiated != null &&
    addToCart > 0
      ? round2((100 * checkoutInitiated) / addToCart)
      : null
  const purchasePerCheckoutPct =
    isStagedFunnelCoverage(coverage) && checkoutInitiated != null && checkoutInitiated > 0
      ? round2((100 * purchases) / checkoutInitiated)
      : null
  const overallCvrPct = clicks > 0 ? round2((100 * purchases) / clicks) : 0

  const costPerAtc =
    isStagedFunnelCoverage(coverage) && addToCart != null && addToCart > 0
      ? round2(spend / addToCart)
      : null
  const costPerCheckout =
    isStagedFunnelCoverage(coverage) && checkoutInitiated != null && checkoutInitiated > 0
      ? round2(spend / checkoutInitiated)
      : null
  const costPerPurchase = purchases > 0 ? round2(spend / purchases) : null
  const roas = spend > 0 ? round2(attributedRevenue / spend) : 0

  return {
    ...input,
    ctrPct,
    atcRatePct,
    checkoutPerAtcPct,
    purchasePerCheckoutPct,
    overallCvrPct,
    costPerAtc,
    costPerCheckout,
    costPerPurchase,
    roas,
  }
}

/** Heuristic bands for Meta full funnel. */
export function diagnoseMetaFunnel(s: PaidMediaFunnelSnapshot): FunnelDiagnostics {
  return {
    atcRate: tier3(s.atcRatePct, 4, 12),
    checkoutFromAtc: tier3(s.checkoutPerAtcPct, 28, 48),
    purchaseFromCheckout: tier3(s.purchasePerCheckoutPct, 32, 55),
    clickToPurchase: tier3(s.overallCvrPct, 0.8, 2.5),
  }
}

/** Google staged funnel uses same bands as Meta; purchase-only falls back to CVR band only. */
export function diagnoseGoogleFunnel(s: PaidMediaFunnelSnapshot): FunnelDiagnostics {
  if (s.coverage === 'google_full') {
    return diagnoseMetaFunnel(s)
  }
  return {
    atcRate: 'na',
    checkoutFromAtc: 'na',
    purchaseFromCheckout: 'na',
    clickToPurchase: tier3(s.overallCvrPct, 0.5, 2),
  }
}

export function emptyMetaFunnelAccumulator(): {
  impressions: number
  clicks: number
  spend: number
  addToCart: number
  checkoutInitiated: number
  purchases: number
  attributedRevenue: number
} {
  return {
    impressions: 0,
    clicks: 0,
    spend: 0,
    addToCart: 0,
    checkoutInitiated: 0,
    purchases: 0,
    attributedRevenue: 0,
  }
}

export function addMetaDailyRowToAccumulator(
  acc: ReturnType<typeof emptyMetaFunnelAccumulator>,
  row: {
    impressions: number
    clicks: number
    spend: number
    conversions: number
    revenue: number
    raw_json: unknown
  }
): void {
  acc.impressions += row.impressions
  acc.clicks += row.clicks
  acc.spend += Number(row.spend)
  acc.purchases += row.conversions
  acc.attributedRevenue += Number(row.revenue)
  const { addToCart, checkoutInitiated } = parseMetaFunnelActionsFromRaw(row.raw_json)
  acc.addToCart += addToCart
  acc.checkoutInitiated += checkoutInitiated
}

export function accumulatorToMetaSnapshot(
  acc: ReturnType<typeof emptyMetaFunnelAccumulator>
): PaidMediaFunnelSnapshot {
  return computePaidMediaFunnel({
    impressions: acc.impressions,
    clicks: acc.clicks,
    spend: acc.spend,
    addToCart: acc.addToCart,
    checkoutInitiated: acc.checkoutInitiated,
    purchases: acc.purchases,
    attributedRevenue: acc.attributedRevenue,
    coverage: 'meta_full',
  })
}

export function googleRowToFunnelSnapshot(row: {
  impressions: number
  clicks: number
  spend: number
  conversions: number
  conversionValue: number
}): PaidMediaFunnelSnapshot {
  return computePaidMediaFunnel({
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    addToCart: null,
    checkoutInitiated: null,
    purchases: row.conversions,
    attributedRevenue: row.conversionValue,
    coverage: 'google_purchase_only',
  })
}

export type GoogleStagedFunnelCounts = {
  addToCart: number
  checkoutInitiated: number
  purchases: number
  purchaseValue: number
}

/**
 * Merge aggregate campaign metrics with staged conversion_action rows.
 * If staged has no purchase count, uses aggregate conversions/value (backward compatible).
 */
export function googleMergedFunnelSnapshot(
  base: {
    impressions: number
    clicks: number
    spend: number
    conversions: number
    conversionValue: number
  },
  staged: GoogleStagedFunnelCounts | null
): PaidMediaFunnelSnapshot {
  const hasStageData =
    staged &&
    (staged.addToCart > 0 ||
      staged.checkoutInitiated > 0 ||
      staged.purchases > 0 ||
      staged.purchaseValue > 0)
  if (!hasStageData) {
    return googleRowToFunnelSnapshot(base)
  }
  const purchases = staged!.purchases > 0 ? staged!.purchases : base.conversions
  const attributedRevenue =
    staged!.purchaseValue > 0 ? staged!.purchaseValue : base.conversionValue
  return computePaidMediaFunnel({
    impressions: base.impressions,
    clicks: base.clicks,
    spend: base.spend,
    addToCart: staged!.addToCart,
    checkoutInitiated: staged!.checkoutInitiated,
    purchases,
    attributedRevenue,
    coverage: 'google_full',
  })
}
