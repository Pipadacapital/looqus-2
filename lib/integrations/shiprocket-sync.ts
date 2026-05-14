import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import {
  getValidToken,
  getShiprocketApiUserToken,
  fetchShiprocketOrders,
  fetchShiprocketShipments,
  fetchShipmentTracking,
  fetchShiprocketChannels,
  fetchOrderById,
  SHIPROCKET_BASE,
  SHIPROCKET_ORDER_SHOW_PATH,
  TERMINAL_STATUS_CODES,
  type ShiprocketOrderRow,
  type ShiprocketShipmentRow,
} from './shiprocket'
import { getPincodeFromRaw, getCityFromRaw, getStateFromRaw } from '@/lib/shiprocket-normalize'

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

/**
 * Resolve courier name from a shipment row (API payload).
 * Shiprocket /shipments response may use courier_name, courier_company_name, carrier_name, etc.
 * Persisting the first non-empty value ensures "By Courier" has data regardless of API key.
 */
function resolveCourierFromShipmentRow(s: ShiprocketShipmentRow): string | null {
  const v =
    (typeof s.courier_name === 'string' && s.courier_name.trim() !== ''
      ? s.courier_name.trim()
      : null) ??
    getStringFromRaw(s, 'courier_company_name') ??
    getStringFromRaw(s, 'carrier_name') ??
    getStringFromRaw(s, 'courier') ??
    getStringFromRaw(s, 'carrier') ??
    getStringFromRaw(s, 'pickup_partner_name') ??
    getStringFromRaw(s, 'logistic_partner') ??
    getStringFromRawPath(s, 'courier.name') ??
    getStringFromRawPath(s, 'courier.company_name')
  return v ?? null
}

/**
 * Resolve courier name from stored rawJson (same key order as resolveCourierFromShipmentRow).
 * Used by backfill to populate courierName from existing payloads without API calls.
 */
export function resolveCourierFromRawJson(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') return null
  const v =
    getStringFromRaw(raw, 'courier_name') ??
    getStringFromRaw(raw, 'courier_company_name') ??
    getStringFromRaw(raw, 'carrier_name') ??
    getStringFromRaw(raw, 'courier') ??
    getStringFromRaw(raw, 'carrier') ??
    getStringFromRaw(raw, 'pickup_partner_name') ??
    getStringFromRaw(raw, 'logistic_partner') ??
    getStringFromRawPath(raw, 'courier.name') ??
    getStringFromRawPath(raw, 'courier.company_name')
  return v ?? null
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

  const courierName = resolveCourierFromShipmentRow(s)
  const shared = {
    orderId: s.order_id ? String(s.order_id) : null,
    channelOrderId,
    status: s.status ?? null,
    statusCode: typeof s.status_code === 'number' ? s.status_code : null,
    courierName,
    awbCode: s.awb_code?.trim() || (typeof s.awb === 'string' ? s.awb.trim() : null),
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
  const updateData = {
    ...shared,
    syncedAt: new Date(),
    // Preserve enriched courier when API returns no courier for this sync pass.
    courierName: courierName ?? undefined,
  }

  await prisma.shiprocketShipment.upsert({
    where: { connectionId_shipmentId: { connectionId, shipmentId } },
    create: { connectionId, shipmentId, ...shared },
    update: updateData,
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
      if (result.courierName != null) {
        data.courierName = result.courierName
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

export type BackfillCourierResult = {
  /** Number of shipments with courierName null at start of this run (candidates for repair). */
  totalCandidates: number
  updatedFromRaw: number
  updatedFromTracking: number
  stillNull: number
  /** True when no rows remain with courierName null (full repair complete). */
  completedFully: boolean
}

const BACKFILL_RAW_BATCH = 500
const BACKFILL_TRACKING_BATCH_PER_REQUEST = 150
const BACKFILL_TRACKING_DELAY_MS = 150

/**
 * Backfill ShiprocketShipment.courierName for rows where it is null.
 * One run: (1) Process ALL candidates from stored rawJson in batches (no API); (2) Then up to
 * trackingBatchPerRequest rows via tracking API (rate-limited). Caller can re-invoke until
 * completedFully is true for a full one-click experience.
 */
export async function backfillShiprocketCourierNames(
  connectionId: string,
  options?: { trackingBatchPerRequest?: number }
): Promise<BackfillCourierResult> {
  const trackingCap = Math.min(
    Math.max(options?.trackingBatchPerRequest ?? BACKFILL_TRACKING_BATCH_PER_REQUEST, 0),
    200
  )
  const totalCandidates = await prisma.shiprocketShipment.count({
    where: { connectionId, courierName: null },
  })
  let updatedFromRaw = 0
  let updatedFromTracking = 0

  // Phase 1: resolve from stored rawJson only (all candidates, no API calls)
  let cursor: string | undefined
  do {
    const batch = await prisma.shiprocketShipment.findMany({
      where: { connectionId, courierName: null, rawJson: { not: Prisma.AnyNull } },
      select: { id: true, rawJson: true, awbCode: true, status: true },
      take: BACKFILL_RAW_BATCH,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (batch.length === 0) break
    for (const row of batch) {
      const raw =
        row.rawJson && typeof row.rawJson === 'object'
          ? (row.rawJson as Record<string, unknown>)
          : null
      // Also backfill awbCode from rawJson.awb if missing.
      const rawAwb =
        raw && typeof raw.awb === 'string' && raw.awb.trim() !== ''
          ? raw.awb.trim()
          : null

      // Mark self-fulfilled shipments explicitly when no AWB is present.
      const isSelfFulfilled =
        (!raw?.awb || raw.awb === '') &&
        (String(row.status ?? '')
          .toUpperCase()
          .includes('SELF') ||
          String(raw?.status ?? '')
            .toUpperCase()
            .includes('SELF'))

      if (isSelfFulfilled) {
        await prisma.shiprocketShipment.update({
          where: { id: row.id },
          data: {
            courierName: 'Self Fulfilled',
            ...(rawAwb && !row.awbCode ? { awbCode: rawAwb } : {}),
          },
        })
        updatedFromRaw++
        continue
      }

      const courier = resolveCourierFromRawJson(row.rawJson)
      if (courier) {
        await prisma.shiprocketShipment.update({
          where: { id: row.id },
          data: {
            courierName: courier,
            ...(rawAwb && !row.awbCode ? { awbCode: rawAwb } : {}),
          },
        })
        updatedFromRaw++
      } else if (rawAwb && !row.awbCode) {
        await prisma.shiprocketShipment.update({
          where: { id: row.id },
          data: { awbCode: rawAwb },
        })
      }
    }
    cursor = batch[batch.length - 1]?.id
  } while (cursor)

  // Phase 2: for remaining null, fetch tracking in iterations until no more resolvable rows.
  if (trackingCap > 0) {
    let token: string | undefined
    try {
      token = await getValidToken(connectionId)
    } catch {
      // Token failure: skip tracking phase
    }
    if (token) {
      const batchSize = Math.min(100, trackingCap)
      const attemptedIds = new Set<string>()
      let totalResolvedFromTracking = 0
      do {
        const toFetch = await prisma.shiprocketShipment.findMany({
          where: {
            connectionId,
            courierName: null,
            id: { notIn: Array.from(attemptedIds) },
            OR: [
              { awbCode: { not: null, notIn: [''] } },
              { rawJson: { not: Prisma.AnyNull } },
            ],
          },
          select: { id: true, shipmentId: true, awbCode: true, rawJson: true },
          take: batchSize,
          orderBy: { id: 'asc' },
        })
        if (toFetch.length === 0) break

        let iterationResolved = 0
        for (let i = 0; i < toFetch.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, BACKFILL_TRACKING_DELAY_MS))
          const shipment = toFetch[i]
          attemptedIds.add(shipment.id)
          const raw =
            shipment.rawJson && typeof shipment.rawJson === 'object'
              ? (shipment.rawJson as Record<string, unknown>)
              : null
          const awb =
            shipment.awbCode ||
            (raw && typeof raw.awb === 'string' && raw.awb.trim() !== ''
              ? raw.awb.trim()
              : null) ||
            null
          if (!awb) continue
          try {
            const result = await fetchShipmentTracking(token, shipment.shipmentId)
            if (result.courierName) {
              await prisma.shiprocketShipment.update({
                where: { id: shipment.id },
                data: { courierName: result.courierName },
              })
              iterationResolved++
            }
          } catch {
            // Skip failed tracking
          }
        }

        totalResolvedFromTracking += iterationResolved
      } while (true)

      updatedFromTracking = totalResolvedFromTracking
    }
  }

  const stillNull = await prisma.shiprocketShipment.count({
    where: { connectionId, courierName: null },
  })

  return {
    totalCandidates,
    updatedFromRaw,
    updatedFromTracking,
    stillNull,
    completedFully: stillNull === 0,
  }
}

export type BackfillPincodeResult = {
  /** Rows with null deliveryPincode at start (candidates). */
  candidates: number
  /** Phase 1: rows updated from shipment.rawJson. */
  shipmentRawHits: number
  /** Phase 2: rows updated from linked ShiprocketOrder.rawJson. */
  linkedOrderHits: number
  /** Phase 3: rows updated from fetchOrderById API. */
  orderApiHits: number
  /** Phase 3: non-fatal API errors (e.g. per-shipment failures). */
  orderApiErrors: string[]
  /** Rows still missing delivery pincode after this run. */
  stillMissing: number
}

const BACKFILL_PINCODE_BATCH = 500
const BACKFILL_PINCODE_API_BATCH = 100
const BACKFILL_PINCODE_API_DELAY_MS = 400

function setDeliveryFromRaw(
  raw: unknown
): { deliveryPincode?: string; deliveryCity?: string; deliveryState?: string } {
  const pin = getPincodeFromRaw(raw)?.trim() || null
  const city = getCityFromRaw(raw)?.trim() || null
  const state = getStateFromRaw(raw)?.trim() || null
  const data: { deliveryPincode?: string; deliveryCity?: string; deliveryState?: string } = {}
  if (pin) data.deliveryPincode = pin
  if (city) data.deliveryCity = city
  if (state) data.deliveryState = state
  return data
}

/**
 * Backfill ShiprocketShipment delivery pincode/city/state for historical rows.
 * 1) From stored shipment rawJson; 2) From linked ShiprocketOrder.rawJson (orders API payload);
 * 3) From Shiprocket order API (GET order by id) when still missing. Persists to deliveryPincode/City/State.
 * Idempotent; does not overwrite existing values. Safe to rerun.
 */
/** Normalize order id for join: Shiprocket APIs may return number or string. */
function normalizeOrderIdForJoin(v: string | null | undefined): string | null {
  if (v == null || String(v).trim() === '') return null
  return String(v).trim()
}

export async function backfillShiprocketPincodes(connectionId: string): Promise<BackfillPincodeResult> {
  const candidates = await prisma.shiprocketShipment.count({
    where: { connectionId, deliveryPincode: null },
  })
  const orderApiErrors: string[] = []
  let shipmentRawHits = 0
  let linkedOrderHits = 0
  let orderApiHits = 0

  // Phase 1: from shipment rawJson
  let cursor: string | undefined
  do {
    const batch = await prisma.shiprocketShipment.findMany({
      where: { connectionId, deliveryPincode: null, rawJson: { not: Prisma.AnyNull } },
      select: { id: true, rawJson: true },
      take: BACKFILL_PINCODE_BATCH,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (batch.length === 0) break
    for (const row of batch) {
      const data = setDeliveryFromRaw(row.rawJson)
      if (Object.keys(data).length > 0) {
        await prisma.shiprocketShipment.update({ where: { id: row.id }, data })
        shipmentRawHits++
      }
    }
    cursor = batch[batch.length - 1]?.id
  } while (cursor)

  // Phase 2: from linked ShiprocketOrder.rawJson.
  // Join: shipment.orderId (from shipments API order_id) === order.shiprocketId (from orders API id). Both normalized to string for reliable match.
  const withOrderId = await prisma.shiprocketShipment.findMany({
    where: { connectionId, deliveryPincode: null, orderId: { not: null } },
    select: { id: true, orderId: true },
    orderBy: { id: 'asc' },
  })
  if (withOrderId.length > 0) {
    const orderIds = [...new Set(withOrderId.map((s) => normalizeOrderIdForJoin(s.orderId)).filter(Boolean))] as string[]
    const orders = await prisma.shiprocketOrder.findMany({
      where: { connectionId, shiprocketId: { in: orderIds }, rawJson: { not: Prisma.AnyNull } },
      select: { shiprocketId: true, rawJson: true },
    })
    // Map by normalized shiprocketId so we match shipment.orderId (string) to order.shiprocketId (string)
    const orderByShiprocketId = new Map<string, unknown>()
    for (const o of orders) {
      const k = normalizeOrderIdForJoin(o.shiprocketId)
      if (k) orderByShiprocketId.set(k, o.rawJson as unknown)
    }
    for (const s of withOrderId) {
      const key = normalizeOrderIdForJoin(s.orderId)
      const orderRaw = key ? orderByShiprocketId.get(key) : null
      if (!orderRaw) continue
      const data = setDeliveryFromRaw(orderRaw)
      if (Object.keys(data).length > 0) {
        await prisma.shiprocketShipment.update({ where: { id: s.id }, data })
        linkedOrderHits++
      }
    }
  }

  // Phase 3: fetch order by id from API for remaining (rate-limited)
  let apiUserToken: string | undefined
  const phase3Candidates = await prisma.shiprocketShipment.count({
    where: { connectionId, deliveryPincode: null, orderId: { not: null } },
  })
  if (phase3Candidates > 0) {
    const conn = await prisma.shiprocketConnection.findUnique({
      where: { id: connectionId },
      select: { shiprocketApiEmail: true, shiprocketApiPassword: true },
    })
    const apiEmail = conn?.shiprocketApiEmail?.trim() ?? ''
    const apiPassword = conn?.shiprocketApiPassword ?? ''
    if (!apiEmail || !apiPassword) {
      orderApiErrors.push(
        'Phase 3 skipped — Shiprocket API User credentials not set. Add them in Settings → Integrations → Shiprocket.'
      )
    } else {
      try {
        apiUserToken = await getShiprocketApiUserToken(apiEmail, apiPassword)
      } catch (err) {
        orderApiErrors.push(`API User token: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (apiUserToken) {
      let iterationResolved = 0
      let remainingAfterIteration = 0
      do {
        iterationResolved = 0
        const batch = await prisma.shiprocketShipment.findMany({
          where: { connectionId, deliveryPincode: null, orderId: { not: null } },
          select: { id: true, orderId: true },
          take: BACKFILL_PINCODE_API_BATCH,
          orderBy: { id: 'asc' },
        })
        if (batch.length === 0) break

        for (const s of batch) {
          try {
            const orderId = s.orderId!.trim()
            const order = await fetchOrderById(apiUserToken, orderId)
            if (order) {
              const data = setDeliveryFromRaw(order)
              if (Object.keys(data).length > 0) {
                await prisma.shiprocketShipment.update({ where: { id: s.id }, data })
                iterationResolved++
                orderApiHits++
              }
            }
            await new Promise((r) => setTimeout(r, BACKFILL_PINCODE_API_DELAY_MS))
          } catch (err) {
            orderApiErrors.push(`Shipment ${s.id} (order ${s.orderId}): ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        remainingAfterIteration = await prisma.shiprocketShipment.count({
          where: { connectionId, deliveryPincode: null, orderId: { not: null } },
        })
      } while (remainingAfterIteration > 0 && iterationResolved > 0)
    }
  }

  const stillMissing = await prisma.shiprocketShipment.count({
    where: { connectionId, deliveryPincode: null },
  })

  return {
    candidates,
    shipmentRawHits,
    linkedOrderHits,
    orderApiHits,
    orderApiErrors,
    stillMissing,
  }
}

/** Keys we try when extracting pincode/city/state (for debug output). */
const ADDRESS_PATHS = [
  'customer_pincode',
  'delivery_code',
  'customer_city',
  'customer_state',
  'order_to_pincode',
  'to_pincode',
  'delivery_pincode',
  'pin_code',
  'pincode',
  'to_address',
  'address',
  'order_to_city',
  'to_city',
  'order_to_state',
  'to_state',
] as const

function rawJsonKeys(raw: unknown): string[] {
  if (raw == null || typeof raw !== 'object') return []
  return Object.keys(raw as Record<string, unknown>)
}

function sampleAddressFromRaw(raw: unknown): Record<string, unknown> {
  if (raw == null || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of ADDRESS_PATHS) {
    const v = o[key]
    if (v !== undefined && v !== null) {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        out[key] = Object.keys(v as Record<string, unknown>).slice(0, 10)
      } else {
        out[key] = typeof v === 'string' ? v.slice(0, 50) : v
      }
    }
  }
  return out
}

export type PincodeBackfillDebugSample = {
  shipmentDbId: string
  shipmentId: string
  orderId: string | null
  /** Top-level keys in shipment.rawJson */
  shipmentRawKeys: string[]
  /** Whether getPincodeFromRaw(shipment.rawJson) returns non-null */
  shipmentHasPincode: boolean
  /** Sample of address-like keys in shipment.rawJson */
  shipmentAddressSample: Record<string, unknown>
  /** Whether a ShiprocketOrder row exists with shiprocketId === shipment.orderId */
  orderFound: boolean
  orderShiprocketId?: string
  orderRawKeys?: string[]
  orderHasPincode?: boolean
  orderAddressSample?: Record<string, unknown>
  /** If we called fetchOrderById (GET /v1/external/orders/show/{id}) */
  apiCalled: boolean
  /** Endpoint called for Phase 3 (e.g. GET /v1/external/orders/show/{id}) */
  endpointCalled?: string
  /** Shiprocket order id passed to the API (must be order id, not shipment id or channel order id) */
  idUsed?: string | null
  /** Whether the order-detail response has data.customer_pincode or data.delivery_code */
  responseHasCustomerPincode?: boolean
  /** Whether we would persist deliveryPincode/deliveryCity/deliveryState from this response */
  wouldPersistDeliveryPincode?: boolean
  apiError?: string
  apiResponseKeys?: string[]
  apiHasPincode?: boolean
  apiAddressSample?: Record<string, unknown>
}

export type PincodeBackfillDebugResult = {
  connectionId: string
  sampleSize: number
  samples: PincodeBackfillDebugSample[]
}

/**
 * Trace 3–5 unresolved ShiprocketShipment rows to see which phase can supply pincode.
 * Use for debugging: which phase is failing and what the actual payload shapes are.
 */
export async function debugPincodeBackfillTrace(
  connectionId: string,
  options?: { sampleSize?: number }
): Promise<PincodeBackfillDebugResult> {
  const sampleSize = Math.min(Math.max(options?.sampleSize ?? 5, 1), 10)
  const shipments = await prisma.shiprocketShipment.findMany({
    where: { connectionId, deliveryPincode: null },
    select: { id: true, shipmentId: true, orderId: true, rawJson: true },
    take: sampleSize,
    orderBy: { id: 'asc' },
  })
  const samples: PincodeBackfillDebugSample[] = []
  let token: string | undefined
  try {
    token = await getValidToken(connectionId)
  } catch {
    // api calls will be skipped
  }
  const orderIds = [...new Set(shipments.map((s) => s.orderId).filter(Boolean))] as string[]
  const orders = await prisma.shiprocketOrder.findMany({
    where: { connectionId, shiprocketId: { in: orderIds } },
    select: { shiprocketId: true, rawJson: true },
  })
  const orderByShiprocketId = new Map(orders.map((o) => [o.shiprocketId, o]))

  for (const s of shipments) {
    const shipmentRawKeys = rawJsonKeys(s.rawJson)
    const shipmentHasPincode = !!(getPincodeFromRaw(s.rawJson)?.trim())
    const shipmentAddressSample = sampleAddressFromRaw(s.rawJson)

    const order = s.orderId ? orderByShiprocketId.get(s.orderId) : null
    const orderFound = !!order
    let orderShiprocketId: string | undefined
    let orderRawKeys: string[] | undefined
    let orderHasPincode: boolean | undefined
    let orderAddressSample: Record<string, unknown> | undefined
    if (order) {
      orderShiprocketId = order.shiprocketId
      orderRawKeys = order.rawJson ? rawJsonKeys(order.rawJson) : []
      orderHasPincode = !!(getPincodeFromRaw(order.rawJson)?.trim())
      orderAddressSample = order.rawJson ? sampleAddressFromRaw(order.rawJson) : undefined
    }

    const orderIdForApi = s.orderId?.trim() ?? null
    const endpointCalled = orderIdForApi
      ? `GET ${SHIPROCKET_BASE}${SHIPROCKET_ORDER_SHOW_PATH}${orderIdForApi}`
      : undefined
    let apiCalled = false
    let apiError: string | undefined
    let apiResponseKeys: string[] | undefined
    let apiHasPincode: boolean | undefined
    let apiAddressSample: Record<string, unknown> | undefined
    let responseHasCustomerPincode: boolean | undefined
    let wouldPersistDeliveryPincode: boolean | undefined
    if (token && orderIdForApi) {
      apiCalled = true
      try {
        const apiOrder = await fetchOrderById(token, orderIdForApi)
        if (apiOrder) {
          apiResponseKeys = rawJsonKeys(apiOrder)
          const pin = getPincodeFromRaw(apiOrder)?.trim()
          apiHasPincode = !!pin
          wouldPersistDeliveryPincode = !!pin
          const raw = apiOrder as Record<string, unknown>
          responseHasCustomerPincode = !!(
            (typeof raw.customer_pincode === 'string' && raw.customer_pincode.trim() !== '') ||
            (typeof raw.delivery_code === 'string' && raw.delivery_code.trim() !== '')
          )
          apiAddressSample = sampleAddressFromRaw(apiOrder)
        } else {
          apiError = 'fetchOrderById returned null'
        }
      } catch (err) {
        apiError = err instanceof Error ? err.message : String(err)
      }
    }

    samples.push({
      shipmentDbId: s.id,
      shipmentId: s.shipmentId,
      orderId: s.orderId,
      shipmentRawKeys,
      shipmentHasPincode,
      shipmentAddressSample,
      orderFound,
      orderShiprocketId,
      orderRawKeys,
      orderHasPincode,
      orderAddressSample,
      apiCalled,
      endpointCalled,
      idUsed: orderIdForApi,
      responseHasCustomerPincode,
      wouldPersistDeliveryPincode,
      apiError,
      apiResponseKeys,
      apiHasPincode,
      apiAddressSample,
    })
  }

  return { connectionId, sampleSize: samples.length, samples }
}
