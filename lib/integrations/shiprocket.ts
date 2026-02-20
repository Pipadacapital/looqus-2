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

export async function fetchShiprocketOrders(
  token: string,
  page = 1,
  perPage = 200
): Promise<{ orders: ShiprocketOrderRow[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  })

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
