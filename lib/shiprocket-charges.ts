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

function fwd(raw: unknown): number {
  return (
    getNumber(raw, 'charges.applied_weight_amount') ??
    getNumber(raw, 'charges.charge_weight_amount') ??
    getNumber(raw, 'charges.freight_charges') ??
    getNumber(raw, 'freight_charges') ??
    0
  )
}

function rto(raw: unknown): number {
  return (
    getNumber(raw, 'charges.applied_weight_amount_rto') ??
    getNumber(raw, 'charges.charged_weight_amount_rto') ??
    0
  )
}

function cod(raw: unknown): number {
  return getNumber(raw, 'charges.cod_charges') ?? 0
}

/** Total charge (fwd + rto + cod) from a shipment's raw_json. */
export function totalChargesFromRaw(rawJson: unknown): number {
  if (rawJson == null) return 0
  return fwd(rawJson) + rto(rawJson) + cod(rawJson)
}
