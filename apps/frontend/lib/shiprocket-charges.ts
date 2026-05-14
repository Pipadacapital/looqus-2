/**
 * Extract shipping charges from Shiprocket shipment raw_json.
 * Used for P&L Shipping Costs (fwd + rto + cod). Matches logic in shiprocket-content.tsx.
 */
function getNumber(raw: unknown, path: string): number | null {
  if (raw == null) return null
  const parts = path.split('.')
  let current: unknown = raw
  for (const p of parts) {
    if (current == null || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[p]
  }
  if (typeof current === 'number' && !Number.isNaN(current)) return current
  if (typeof current === 'string') {
    const n = parseFloat(current)
    return Number.isNaN(n) ? null : n
  }
  return null
}

/** Forward (outbound) shipping charge from a shipment's raw_json. */
export function forwardChargesFromRaw(rawJson: unknown): number {
  if (rawJson == null) return 0
  return (
    getNumber(rawJson, 'charges.applied_weight_amount') ??
    getNumber(rawJson, 'charges.charge_weight_amount') ??
    getNumber(rawJson, 'charges.freight_charges') ??
    getNumber(rawJson, 'freight_charges') ??
    0
  )
}

/** RTO (return) shipping charge from a shipment's raw_json. */
export function rtoChargesFromRaw(rawJson: unknown): number {
  if (rawJson == null) return 0
  return (
    getNumber(rawJson, 'charges.applied_weight_amount_rto') ??
    getNumber(rawJson, 'charges.charged_weight_amount_rto') ??
    0
  )
}

/** COD handling charge from a shipment's raw_json. */
export function codChargesFromRaw(rawJson: unknown): number {
  if (rawJson == null) return 0
  return getNumber(rawJson, 'charges.cod_charges') ?? 0
}

/** Total charge (forward + RTO + COD) from a shipment's raw_json. */
export function totalChargesFromRaw(rawJson: unknown): number {
  if (rawJson == null) return 0
  return forwardChargesFromRaw(rawJson) + rtoChargesFromRaw(rawJson) + codChargesFromRaw(rawJson)
}

/**
 * Shiprocket-native "revenue lost" for an RTO shipment (order/shipment value we did not realize).
 * Used for RTO Analytics main KPI; no Shopify dependency.
 * - COD: amount that would have been collected (cod_amount).
 * - Prepaid: order total from Shiprocket order or raw payload (sell_amount / order_amount / total_amount).
 */
export function shiprocketRtoRevenueLost(
  shipment: { codAmount: number | null; isCod: boolean },
  rawJson: unknown,
  orderTotalFromOrder: number | null
): number {
  if (shipment.isCod) {
    const cod =
      shipment.codAmount != null && shipment.codAmount > 0
        ? Number(shipment.codAmount)
        : getNumber(rawJson, 'cod_amount')
    return cod ?? 0
  }
  const fromOrder = orderTotalFromOrder != null && orderTotalFromOrder > 0 ? orderTotalFromOrder : null
  if (fromOrder != null) return fromOrder
  return (
    getNumber(rawJson, 'sell_amount') ??
    getNumber(rawJson, 'order_amount') ??
    getNumber(rawJson, 'total_amount') ??
    0
  )
}
