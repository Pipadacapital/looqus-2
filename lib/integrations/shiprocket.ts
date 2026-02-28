import { prisma } from '@/lib/prisma'

const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external'
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

// Shiprocket status codes that indicate RTO (Return to Origin)
export const RTO_STATUS_CODES = new Set([9, 10, 14, 20, 40, 41, 46])

// Terminal statuses — no need to re-fetch tracking for these
export const TERMINAL_STATUS_CODES = new Set([7, 8, 10, 12])

export type ShiprocketTrackingResult = {
  statusCode: number | null
  statusText: string | null
  channelOrderId: string | null
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
      return { statusCode: null, statusText: null, channelOrderId: null }
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

  return { statusCode, statusText, channelOrderId }
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
  const orders: ShiprocketOrderRow[] = data.data ?? []
  const meta = data.meta ?? {}
  const hasMore = meta.current_page < meta.last_page

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
  const shipments: ShiprocketShipmentRow[] = data.data ?? []
  const meta = data.meta ?? {}
  const hasMore = meta.current_page < meta.last_page

  return { shipments, hasMore }
}
