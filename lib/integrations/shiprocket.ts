import { prisma } from '@/lib/prisma'
import { RTO_STATUS_CODES as RTO_STATUS_CODES_ARRAY, TERMINAL_STATUS_CODES as TERMINAL_STATUS_CODES_ARRAY } from '@/lib/workspace-metrics/constants'

export const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external'
const TOKEN_MAX_AGE_MS = 9 * 24 * 60 * 60 * 1000 // 9 days (token valid ~10 days)

export async function loginShiprocket(
  email: string,
  password: string
): Promise<string> {
  const res = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const text = await res.text()
    let msg = `Shiprocket login failed (${res.status})`
    try {
      const parsed = JSON.parse(text)
      if (parsed.message) msg = parsed.message
    } catch {
      // use default msg
    }
    throw new Error(msg)
  }

  const data = await res.json()
  if (!data.token) {
    throw new Error('Shiprocket login succeeded but no token returned')
  }
  return data.token as string
}

export async function getShiprocketApiUserToken(
  apiEmail: string,
  apiPassword: string
): Promise<string> {
  const res = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: apiEmail, password: apiPassword }),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = `Shiprocket API User login failed (${res.status})`
    try {
      const parsed = JSON.parse(text)
      if (parsed.message) msg = parsed.message
    } catch {
      // use default msg
    }
    throw new Error(msg)
  }
  const data = await res.json()
  if (!data.token) {
    throw new Error('Shiprocket API User login succeeded but no token returned')
  }
  return data.token as string
}

/**
 * Returns a valid Shiprocket bearer token for a workspace connection.
 * Re-authenticates if the token is expired or missing.
 */
export async function getValidToken(connectionId: string): Promise<string> {
  const connection = await prisma.shiprocketConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, accessToken: true, tokenObtainedAt: true, email: true, password: true },
  })

  if (!connection) throw new Error('Shiprocket connection not found')

  const isExpired =
    !connection.accessToken ||
    !connection.tokenObtainedAt ||
    Date.now() - connection.tokenObtainedAt.getTime() > TOKEN_MAX_AGE_MS

  if (!isExpired && connection.accessToken) return connection.accessToken

  const token = await loginShiprocket(connection.email, connection.password)
  await prisma.shiprocketConnection.update({
    where: { id: connection.id },
    data: { accessToken: token, tokenObtainedAt: new Date() },
  })
  return token
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export type ShiprocketOrderRow = {
  id: number
  channel_order_id: string | null
  status: string | null
  status_code: number | null
  payment_method: string | null
  total: string | null
  order_date: string | null
  channel_name: string | null
  [key: string]: unknown
}

export type ShiprocketShipmentRow = {
  id: number
  order_id: string | null
  channel_order_id: string | null
  status: string | null
  status_code: number | null
  courier_name: string | null
  awb_code: string | null
  is_cod: boolean
  cod_amount: string | null
  shipped_date: string | null
  delivered_date: string | null
  rto_initiated_date: string | null
  charges: string | null
  [key: string]: unknown
}

// Re-export as Set for sync/Prisma notIn; array source is workspace-metrics/constants
export const RTO_STATUS_CODES = new Set(RTO_STATUS_CODES_ARRAY)
export const TERMINAL_STATUS_CODES = new Set(TERMINAL_STATUS_CODES_ARRAY)

export type ShiprocketTrackingResult = {
  statusCode: number | null
  statusText: string | null
  channelOrderId: string | null
  /** Courier name when present in tracking payload (used to backfill shipment.courierName). */
  courierName: string | null
}

function trimString(val: unknown): string | null {
  if (typeof val !== 'string' || val.trim() === '') return null
  return val.trim()
}

export async function fetchShipmentTracking(
  token: string,
  shipmentId: string
): Promise<ShiprocketTrackingResult> {
  const res = await fetch(
    `${SHIPROCKET_BASE}/courier/track/shipment/${shipmentId}`,
    { headers: authHeaders(token) }
  )

  if (!res.ok) {
    if (res.status === 404 || res.status === 422) {
      return { statusCode: null, statusText: null, channelOrderId: null, courierName: null }
    }
    const text = await res.text().catch(() => '')
    throw new Error(`Tracking fetch failed (${res.status}): ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  const td = data?.tracking_data

  const shipmentTrack = td?.shipment_track?.[0]
  const statusCode =
    typeof td?.shipment_status === 'number'
      ? td.shipment_status
      : typeof shipmentTrack?.current_status_id === 'number'
        ? shipmentTrack.current_status_id
        : null
  const statusText =
    shipmentTrack?.current_status ?? td?.shipment_status_text ?? null
  const channelOrderId =
    shipmentTrack?.channel_order_id ?? shipmentTrack?.order_id_string ?? null
  const courierName =
    trimString(shipmentTrack?.courier_name) ??
    trimString(shipmentTrack?.carrier_name) ??
    trimString(shipmentTrack?.courier) ??
    trimString(td?.courier_name) ??
    trimString(td?.courier_company_name) ??
    null

  return { statusCode, statusText, channelOrderId, courierName }
}

export type ShiprocketChannel = {
  id: number
  name: string
  [key: string]: unknown
}

export async function fetchShiprocketChannels(
  token: string
): Promise<ShiprocketChannel[]> {
  const res = await fetch(`${SHIPROCKET_BASE}/channels`, {
    headers: authHeaders(token),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Shiprocket channels fetch failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const raw: unknown[] = data?.data ?? data ?? []
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (c): c is ShiprocketChannel =>
      c != null && typeof c === 'object' && 'id' in c && 'name' in c
  )
}

export async function fetchShiprocketOrders(
  token: string,
  page = 1,
  perPage = 200,
  channelId?: string
): Promise<{ orders: ShiprocketOrderRow[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  })
  if (channelId) params.set('channel_id', channelId)

  const res = await fetch(`${SHIPROCKET_BASE}/orders?${params}`, {
    headers: authHeaders(token),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shiprocket orders fetch failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const data = await res.json()

  // Support multiple response shapes: { data: [] }, { orders: [] }, or array at root
  let orders: ShiprocketOrderRow[] = []
  if (Array.isArray(data.data)) orders = data.data
  else if (Array.isArray(data.orders)) orders = data.orders
  else if (Array.isArray(data)) orders = data

  const meta = data.meta ?? data
  const currentPage = Number(meta?.current_page ?? meta?.currentPage ?? 1)
  const lastPage = Number(meta?.last_page ?? meta?.lastPage ?? 1)
  // Keep fetching when we got a full page (API may report last_page=1 incorrectly or return oldest first)
  const hasValidMeta = Number.isFinite(currentPage) && Number.isFinite(lastPage) && lastPage >= 1
  const hasMore = hasValidMeta
    ? currentPage < lastPage || orders.length >= perPage
    : orders.length >= perPage

  return { orders, hasMore }
}

export async function fetchShiprocketShipments(
  token: string,
  page = 1,
  perPage = 200
): Promise<{ shipments: ShiprocketShipmentRow[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  })

  const res = await fetch(`${SHIPROCKET_BASE}/shipments?${params}`, {
    headers: authHeaders(token),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shiprocket shipments fetch failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const data = await res.json()

  // Support multiple response shapes: { data: [] }, { shipments: [] }, or array at root
  let shipments: ShiprocketShipmentRow[] = []
  if (Array.isArray(data.data)) shipments = data.data
  else if (Array.isArray(data.shipments)) shipments = data.shipments
  else if (Array.isArray(data)) shipments = data

  const meta = data.meta ?? data
  const currentPage = Number(meta?.current_page ?? meta?.currentPage ?? 1)
  const lastPage = Number(meta?.last_page ?? meta?.lastPage ?? 1)
  // Keep fetching when we got a full page (API may report last_page=1 incorrectly or return oldest first)
  const hasValidMeta = Number.isFinite(currentPage) && Number.isFinite(lastPage) && lastPage >= 1
  const hasMore = hasValidMeta
    ? currentPage < lastPage || shipments.length >= perPage
    : shipments.length >= perPage

  return { shipments, hasMore }
}

/** Documented Shiprocket endpoint for specific order details (destination pincode/city/state). */
export const SHIPROCKET_ORDER_SHOW_PATH = '/orders/show/'

/**
 * Fetch a single order by Shiprocket order id (GET /v1/external/orders/show/{id}).
 * Used by pincode backfill to get destination fields: customer_pincode, delivery_code, customer_city, customer_state.
 * Returns the order object (response data.data) or null. Id must be the Shiprocket order id, not shipment id or channel order id.
 */
export async function fetchOrderById(
  token: string,
  orderId: string
): Promise<Record<string, unknown> | null> {
  const id = encodeURIComponent(String(orderId).trim())
  const url = `${SHIPROCKET_BASE}${SHIPROCKET_ORDER_SHOW_PATH}${id}`
  const res = await fetch(url, { headers: authHeaders(token) })
  if (!res.ok) {
    if (res.status === 404 || res.status === 422) return null
    const text = await res.text().catch(() => '')
    throw new Error(`Order fetch failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  // Docs: response has data.customer_pincode, data.delivery_code, data.customer_city, data.customer_state
  const order = data?.data ?? data?.order ?? data
  if (order != null && typeof order === 'object') return order as Record<string, unknown>
  return null
}
