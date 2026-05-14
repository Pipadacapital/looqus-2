/**
 * Normalize Shiprocket shipment fields for reporting (COD/prepaid, courier).
 * Uses DB fields first, then rawJson fallbacks so counts work even when API shape varies.
 */

function getStringFromRaw(raw: unknown, path: string): string | null {
  if (raw == null || typeof raw !== 'object') return null
  const parts = path.split('.')
  let cur: unknown = raw
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[p]
  }
  if (typeof cur === 'string' && cur.trim() !== '') return cur.trim()
  if (typeof cur === 'number') return String(cur)
  return null
}

function getBoolFromRaw(raw: unknown, path: string): boolean | null {
  if (raw == null || typeof raw !== 'object') return null
  const parts = path.split('.')
  let cur: unknown = raw
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[p]
  }
  if (typeof cur === 'boolean') return cur
  if (cur === 1 || cur === '1' || (typeof cur === 'string' && cur.toLowerCase() === 'true')) return true
  if (cur === 0 || cur === '0' || (typeof cur === 'string' && cur.toLowerCase() === 'false')) return false
  return null
}

export type ShipmentForNormalize = {
  isCod?: boolean | null
  paymentMethod?: string | null
  courierName?: string | null
  rawJson?: unknown
}

/**
 * Resolve COD vs Prepaid from shipment.
 * Uses isCod, then paymentMethod (case-insensitive), then rawJson payment_method / is_cod.
 */
export function isCodShipment(s: ShipmentForNormalize): boolean {
  if (s.isCod === true) return true
  const pm = (s.paymentMethod ?? '').trim().toUpperCase()
  if (pm === 'COD') return true
  const rawPm = getStringFromRaw(s.rawJson, 'payment_method')?.toUpperCase()
  if (rawPm === 'COD') return true
  const rawCod = getBoolFromRaw(s.rawJson, 'is_cod')
  if (rawCod === true) return true
  return false
}

/**
 * Resolve courier name from shipment.
 * Uses courierName, then rawJson courier_name, carrier_name, courier, carrier.
 */
export function getCourierName(s: ShipmentForNormalize): string {
  const fromDb = s.courierName?.trim()
  if (fromDb) return fromDb
  const raw =
    getStringFromRaw(s.rawJson, 'courier_name') ??
    getStringFromRaw(s.rawJson, 'carrier_name') ??
    getStringFromRaw(s.rawJson, 'courier') ??
    getStringFromRaw(s.rawJson, 'carrier')
  if (raw) return raw
  return '—'
}

/**
 * Extract delivery pincode from Shiprocket raw payload.
 * Primary: order details API (data.customer_pincode, data.delivery_code). Fallback: other common keys.
 */
export function getPincodeFromRaw(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') return null
  const v =
    getStringFromRaw(raw, 'customer_pincode') ??
    getStringFromRaw(raw, 'delivery_code') ??
    getStringFromRaw(raw, 'data.customer_pincode') ??
    getStringFromRaw(raw, 'data.delivery_code') ??
    getStringFromRaw(raw, 'order_to_pincode') ??
    getStringFromRaw(raw, 'to_pincode') ??
    getStringFromRaw(raw, 'delivery_pincode') ??
    getStringFromRaw(raw, 'pin_code') ??
    getStringFromRaw(raw, 'pincode') ??
    getStringFromRaw(raw, 'order_to_postcode') ??
    getStringFromRaw(raw, 'to_postcode') ??
    getStringFromRaw(raw, 'to_address.pin_code') ??
    getStringFromRaw(raw, 'to_address.pincode') ??
    getStringFromRaw(raw, 'address.pin_code') ??
    getStringFromRaw(raw, 'address.pincode') ??
    getStringFromRaw(raw, 'address.zip') ??
    getStringFromRaw(raw, 'delivery_address.pin_code') ??
    getStringFromRaw(raw, 'shipping_address.pin_code')
  return v ?? null
}

/**
 * Extract delivery city from Shiprocket raw payload.
 * Primary: order details API (data.customer_city). Fallback: other common keys.
 */
export function getCityFromRaw(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') return null
  const v =
    getStringFromRaw(raw, 'customer_city') ??
    getStringFromRaw(raw, 'data.customer_city') ??
    getStringFromRaw(raw, 'order_to_city') ??
    getStringFromRaw(raw, 'to_city') ??
    getStringFromRaw(raw, 'delivery_city') ??
    getStringFromRaw(raw, 'to_address.city') ??
    getStringFromRaw(raw, 'address.city') ??
    getStringFromRaw(raw, 'delivery_address.city') ??
    getStringFromRaw(raw, 'shipping_address.city')
  return v ?? null
}

/**
 * Extract delivery state from Shiprocket raw payload.
 * Primary: order details API (data.customer_state). Fallback: other common keys.
 */
export function getStateFromRaw(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') return null
  const v =
    getStringFromRaw(raw, 'customer_state') ??
    getStringFromRaw(raw, 'data.customer_state') ??
    getStringFromRaw(raw, 'order_to_state') ??
    getStringFromRaw(raw, 'to_state') ??
    getStringFromRaw(raw, 'delivery_state') ??
    getStringFromRaw(raw, 'to_address.state') ??
    getStringFromRaw(raw, 'address.state') ??
    getStringFromRaw(raw, 'delivery_address.state') ??
    getStringFromRaw(raw, 'shipping_address.state')
  return v ?? null
}
