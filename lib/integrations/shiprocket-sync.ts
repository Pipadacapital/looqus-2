import { prisma } from '@/lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'
import {
  getValidToken,
  fetchShiprocketOrders,
  fetchShiprocketShipments,
  fetchShipmentTracking,
  fetchShiprocketChannels,
  TERMINAL_STATUS_CODES,
  type ShiprocketOrderRow,
  type ShiprocketShipmentRow,
} from './shiprocket'

/**
 * Safely coerce a Shiprocket API value into a Prisma Decimal.
 * The API sometimes returns objects like { currency: "INR", amount: 123 }
 * instead of a plain number/string.
 */
function toDecimalSafe(val: unknown, fieldName?: string): Decimal | null {
  if (val == null) return null

  if (typeof val === 'number') return new Decimal(val)
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (trimmed === '' || isNaN(Number(trimmed))) return null
    return new Decimal(trimmed)
  }

  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    const numeric = obj.amount ?? obj.value ?? obj.total ?? obj.price
    if (numeric != null && (typeof numeric === 'number' || typeof numeric === 'string')) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[shiprocket-sync] ${fieldName ?? 'field'}: coerced object to numeric`, {
          extractedValue: numeric,
          originalKeys: Object.keys(obj),
        })
      }
      return toDecimalSafe(numeric, fieldName)
    }

    if (process.env.NODE_ENV === 'development') {
      console.warn(`[shiprocket-sync] ${fieldName ?? 'field'}: non-numeric object, setting null`, {
        keys: Object.keys(obj),
      })
    }
    return null
  }

  return null
}

function toDateSafe(val: unknown): Date | null {
  if (val == null) return null
  if (typeof val === 'string' && val.trim() !== '') {
    const d = new Date(val)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * Parse Shiprocket's created_at format like "13th Mar 2025 10:42 AM"
 * into a proper Date. Falls back to standard Date.parse.
 */
function parseShiprocketDate(val: unknown): Date | null {
  if (val == null) return null
  if (typeof val !== 'string' || val.trim() === '') return null
  const cleaned = val.replace(/(\d+)(st|nd|rd|th)/i, '$1')
  const d = new Date(cleaned)
  return isNaN(d.getTime()) ? toDateSafe(val) : d
}

function getStringFromRaw(raw: unknown, key: string): string | null {
  if (raw == null || typeof raw !== 'object') return null
  const v = (raw as Record<string, unknown>)[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** Get string from raw object by dot path (e.g. "charges.zone") or top-level key. */
function getStringFromRawPath(raw: unknown, path: string): string | null {
  if (raw == null || typeof raw !== 'object') return null
  const keys = path.split('.')
  let cur: unknown = raw
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[k]
  }
  if (typeof cur === 'string' && cur.trim() !== '') return cur.trim()
  if (typeof cur === 'number' && !Number.isNaN(cur)) return String(cur)
  return null
}

/** Get shipment created date from raw row (same logic as upsertShipment). */
function getShipmentCreatedAt(s: ShiprocketShipmentRow): Date | null {
  const createdAtRaw =
    getStringFromRaw(s, 'created_at') ??
    getStringFromRaw(s, 'creation_date') ??
    getStringFromRaw(s, 'created_date') ??
    getStringFromRaw(s, 'date') ??
    getStringFromRawPath(s, 'created_at') ??
    getStringFromRawPath(s, 'createdAt')
  return parseShiprocketDate(createdAtRaw)
}

export async function syncShiprocketForConnection(
  connectionId: string,
  options?: { days?: number }
) {
  const connection = await prisma.shiprocketConnection.findUnique({
    where: { id: connectionId },
  })
  if (!connection || connection.status !== 'CONNECTED') return

  const errors: string[] = []
  let token: string

  try {
    token = await getValidToken(connectionId)
  } catch (err) {
    await prisma.shiprocketConnection.update({
      where: { id: connectionId },
      data: {
        status: 'EXPIRED',
        lastSyncError: `Token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    })
    throw err
  }

  // Only sync data within the given window (default 90 days for backfill; use 1 for daily cron)
  const days = options?.days ?? 90
  const toDate = new Date()
  const fromDate = new Date()
  fromDate.setUTCDate(fromDate.getUTCDate() - days)

  // Discover channels dynamically
  try {
    const channels = await fetchShiprocketChannels(token)
    const channelIds = channels.map((c) => String(c.id))
    const updateData: Record<string, unknown> = {
      channels: channels as object[],
    }
    if (
      !connection.selectedChannelIds ||
      connection.selectedChannelIds.length === 0
    ) {
      updateData.selectedChannelIds = channelIds
    }
    await prisma.shiprocketConnection.update({
      where: { id: connectionId },
      data: updateData,
    })
  } catch (err) {
    errors.push(`Channels: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Re-read connection to get latest selectedChannelIds
  const refreshedConn = await prisma.shiprocketConnection.findUnique({
    where: { id: connectionId },
    select: { selectedChannelIds: true },
  })
  const selectedIds = refreshedConn?.selectedChannelIds ?? []

  // Sync orders per selected channel (paginated)
  if (selectedIds.length > 0) {
    for (const channelId of selectedIds) {
      try {
        let page = 1
        let hasMore = true
        while (hasMore) {
          const result = await fetchShiprocketOrders(token, page, 200, channelId)
          const validOrders = result.orders.filter(
            (o) => o != null && (typeof o.id === 'number' || typeof o.id === 'string')
          )
          for (const order of validOrders) {
            const orderDate = toDateSafe(order.order_date)
            if (!orderDate || (orderDate >= fromDate && orderDate <= toDate)) {
              await upsertOrder(connectionId, order, channelId)
            }
          }
          hasMore = result.hasMore
          page++
          if (page > 100) break
        }
      } catch (err) {
        errors.push(`Orders(ch:${channelId}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } else {
    try {
      let page = 1
      let hasMore = true
      while (hasMore) {
        const result = await fetchShiprocketOrders(token, page, 200)
        const validOrders = result.orders.filter(
          (o) => o != null && (typeof o.id === 'number' || typeof o.id === 'string')
        )
        for (const order of validOrders) {
          const orderDate = toDateSafe(order.order_date)
          if (!orderDate || (orderDate >= fromDate && orderDate <= toDate)) {
            await upsertOrder(connectionId, order)
          }
        }
        hasMore = result.hasMore
        page++
        if (page > 100) break
      }
    } catch (err) {
      errors.push(`Orders: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Sync shipments (paginated — endpoint doesn't support channel_id filter)
  try {
    let page = 1
    let hasMore = true
    while (hasMore) {
      const result = await fetchShiprocketShipments(token, page, 200)
      const validShipments = result.shipments.filter(
        (s) => s != null && (typeof s.id === 'number' || typeof s.id === 'string')
      )
      for (const shipment of validShipments) {
        const shipDate = getShipmentCreatedAt(shipment)
        if (!shipDate || (shipDate >= fromDate && shipDate <= toDate)) {
          await upsertShipment(connectionId, shipment)
        }
      }
      hasMore = result.hasMore
      page++
      if (page > 100) break
    }
  } catch (err) {
    errors.push(`Shipments: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Refresh tracking for non-terminal shipments
  try {
    const trackingErrors = await syncTrackingForConnection(connectionId, token)
    if (trackingErrors > 0) {
      errors.push(`Tracking: ${trackingErrors} shipment(s) failed to update`)
    }
  } catch (err) {
    errors.push(`Tracking: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Map channelOrderId → Shopify order name for unmapped shipments
  try {
    await mapShiprocketToShopify(connectionId)
  } catch (err) {
    errors.push(`Shopify mapping: ${err instanceof Error ? err.message : String(err)}`)
  }

  await prisma.shiprocketConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      lastSyncError: errors.length > 0 ? errors.join('; ') : null,
    },
  })

  return { warning: errors.length > 0 ? errors.join('; ') : undefined }
}

export async function discoverChannels(connectionId: string) {
  const token = await getValidToken(connectionId)
  const channels = await fetchShiprocketChannels(token)
  const channelIds = channels.map((c) => String(c.id))

  const conn = await prisma.shiprocketConnection.findUnique({
    where: { id: connectionId },
    select: { selectedChannelIds: true },
  })

  const updateData: Record<string, unknown> = {
    channels: channels as object[],
  }
  if (!conn?.selectedChannelIds || conn.selectedChannelIds.length === 0) {
    updateData.selectedChannelIds = channelIds
  }

  await prisma.shiprocketConnection.update({
    where: { id: connectionId },
    data: updateData,
  })

  return channels
}

export type SyncAllShiprocketResult = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  status: 'ok' | 'failed'
  error?: string
}

export async function syncAllShiprocket(options?: {
  days?: number
}): Promise<{
  synced: number
  failed: number
  results: SyncAllShiprocketResult[]
}> {
  const connections = await prisma.shiprocketConnection.findMany({
    where: { status: 'CONNECTED' },
    select: {
      id: true,
      workspaceId: true,
      workspace: { select: { name: true } },
    },
  })

  const results: SyncAllShiprocketResult[] = []

  for (const c of connections) {
    try {
      await syncShiprocketForConnection(c.id, options)
      results.push({
        connectionId: c.id,
        workspaceId: c.workspaceId,
        workspaceName: c.workspace?.name ?? 'Unknown',
        status: 'ok',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Shiprocket sync failed for connection ${c.id}:`, err)
      results.push({
        connectionId: c.id,
        workspaceId: c.workspaceId,
        workspaceName: c.workspace?.name ?? 'Unknown',
        status: 'failed',
        error: message,
      })
    }
  }

  return {
    synced: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  }
}

async function upsertOrder(
  connectionId: string,
  order: ShiprocketOrderRow,
  channelId?: string
) {
  const shiprocketId = String(order.id)
  const total = toDecimalSafe(order.total, `order[${shiprocketId}].total`)
  const orderDate = toDateSafe(order.order_date)
  const resolvedChannelId =
    channelId ??
    (typeof (order as Record<string, unknown>).channel_id === 'number'
      ? String((order as Record<string, unknown>).channel_id)
      : null)

  const shared = {
    channelId: resolvedChannelId,
    channelOrderId: order.channel_order_id ?? null,
    status: order.status ?? null,
    statusCode: typeof order.status_code === 'number' ? order.status_code : null,
    paymentMethod: order.payment_method ?? null,
    total,
    orderDate,
    channelName: order.channel_name ?? null,
    rawJson: order as object,
  }

  await prisma.shiprocketOrder.upsert({
    where: { connectionId_shiprocketId: { connectionId, shiprocketId } },
    create: { connectionId, shiprocketId, ...shared },
    update: { ...shared, syncedAt: new Date() },
  })
}

async function upsertShipment(connectionId: string, s: ShiprocketShipmentRow) {
  const shipmentId = String(s.id)
  const codAmount = toDecimalSafe(s.cod_amount, `shipment[${shipmentId}].cod_amount`)
  const charges = toDecimalSafe(s.charges, `shipment[${shipmentId}].charges`)
  const shippedAt = toDateSafe(s.shipped_date)
  const deliveredAt = toDateSafe(s.delivered_date)
  const rtoInitiatedAt = toDateSafe(s.rto_initiated_date)
  const channelOrderId =
    typeof s.channel_order_id === 'string' ? s.channel_order_id : null
  // Resolve created date from multiple possible API keys so latest shipments get a date
  const createdAtRaw =
    getStringFromRaw(s, 'created_at') ??
    getStringFromRaw(s, 'creation_date') ??
    getStringFromRaw(s, 'created_date') ??
    getStringFromRaw(s, 'date') ??
    getStringFromRawPath(s, 'created_at') ??
    getStringFromRawPath(s, 'createdAt')
  const shiprocketCreatedAt = parseShiprocketDate(createdAtRaw)
  const paymentMethod = getStringFromRaw(s, 'payment_method')

  const shared = {
    orderId: s.order_id ? String(s.order_id) : null,
    channelOrderId,
    status: s.status ?? null,
    statusCode: typeof s.status_code === 'number' ? s.status_code : null,
    courierName: s.courier_name ?? null,
    awbCode: s.awb_code ?? null,
    isCod: !!s.is_cod,
    codAmount,
    paymentMethod,
    shippedAt,
    deliveredAt,
    rtoInitiatedAt,
    charges,
    shiprocketCreatedAt,
    rawJson: s as object,
  }

  await prisma.shiprocketShipment.upsert({
    where: { connectionId_shipmentId: { connectionId, shipmentId } },
    create: { connectionId, shipmentId, ...shared },
    update: { ...shared, syncedAt: new Date() },
  })
}

const TRACKING_BATCH_SIZE = 50

/** Returns number of tracking fetch failures. */
async function syncTrackingForConnection(
  connectionId: string,
  token: string
): Promise<number> {
  const shipments = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId,
      OR: [
        { trackingStatusCode: null },
        { trackingStatusCode: { notIn: [...TERMINAL_STATUS_CODES] } },
      ],
    },
    select: { id: true, shipmentId: true },
    take: 200,
  })

  if (shipments.length === 0) return 0

  let failures = 0
  let processed = 0
  for (const shipment of shipments) {
    try {
      const result = await fetchShipmentTracking(token, shipment.shipmentId)

      const data: Record<string, unknown> = {
        trackingUpdatedAt: new Date(),
      }
      if (result.statusCode != null) {
        data.trackingStatusCode = result.statusCode
      }
      if (result.statusText != null) {
        data.trackingStatus = result.statusText
      }
      if (result.channelOrderId != null) {
        data.channelOrderId = result.channelOrderId
      }

      await prisma.shiprocketShipment.update({
        where: { id: shipment.id },
        data,
      })

      processed++
      if (processed % TRACKING_BATCH_SIZE === 0) {
        await new Promise((r) => setTimeout(r, 500))
      }
    } catch (err) {
      failures++
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[shiprocket-sync] tracking failed for shipment ${shipment.shipmentId}:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }
  }
  return failures
}

async function mapShiprocketToShopify(connectionId: string) {
  const unmapped = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId,
      shopifyOrderName: null,
      channelOrderId: { not: null },
    },
    select: { id: true, channelOrderId: true },
    take: 500,
  })

  if (unmapped.length === 0) return

  const conn = await prisma.shiprocketConnection.findUnique({
    where: { id: connectionId },
    select: { workspaceId: true },
  })
  if (!conn) return

  const shopifyConn = await prisma.shopifyConnection.findFirst({
    where: { workspaceId: conn.workspaceId, status: 'CONNECTED' },
    select: { id: true },
  })
  if (!shopifyConn) return

  const refs = unmapped
    .map((s) => s.channelOrderId!)
    .filter((id) => id.trim() !== '')
  const cleanRefs = refs.map((id) => id.replace(/^#/, '').trim())

  const shopifyOrders = await prisma.shopifyOrder.findMany({
    where: {
      connectionId: shopifyConn.id,
      OR: [
        { orderNumber: { in: cleanRefs } },
        { name: { in: refs } },
        { name: { in: cleanRefs.map((r) => `#${r}`) } },
      ],
    },
    select: { orderNumber: true, name: true },
  })

  const nameMap = new Map<string, string>()
  for (const o of shopifyOrders) {
    nameMap.set(o.orderNumber, o.name)
    nameMap.set(o.name, o.name)
    nameMap.set(o.name.replace(/^#/, ''), o.name)
  }

  for (const s of unmapped) {
    const ref = s.channelOrderId!
    const cleanRef = ref.replace(/^#/, '').trim()
    const shopifyName = nameMap.get(cleanRef) ?? nameMap.get(ref) ?? null
    if (shopifyName) {
      await prisma.shiprocketShipment.update({
        where: { id: s.id },
        data: { shopifyOrderName: shopifyName },
      })
    }
  }
}
