import { prisma } from '@/lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'
import {
  getValidToken,
  fetchShiprocketOrders,
  fetchShiprocketShipments,
  type ShiprocketOrderRow,
  type ShiprocketShipmentRow,
} from './shiprocket'

export async function syncShiprocketForConnection(connectionId: string) {
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
    return
  }

  // Sync orders (paginated)
  try {
    let page = 1
    let hasMore = true
    while (hasMore) {
      const result = await fetchShiprocketOrders(token, page, 200)
      for (const order of result.orders) {
        await upsertOrder(connectionId, order)
      }
      hasMore = result.hasMore
      page++
      if (page > 50) break // safety cap
    }
  } catch (err) {
    errors.push(`Orders: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Sync shipments (paginated)
  try {
    let page = 1
    let hasMore = true
    while (hasMore) {
      const result = await fetchShiprocketShipments(token, page, 200)
      for (const shipment of result.shipments) {
        await upsertShipment(connectionId, shipment)
      }
      hasMore = result.hasMore
      page++
      if (page > 50) break
    }
  } catch (err) {
    errors.push(`Shipments: ${err instanceof Error ? err.message : String(err)}`)
  }

  await prisma.shiprocketConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      lastSyncError: errors.length > 0 ? errors.join('; ') : null,
    },
  })
}

async function upsertOrder(connectionId: string, order: ShiprocketOrderRow) {
  const shiprocketId = String(order.id)
  await prisma.shiprocketOrder.upsert({
    where: { connectionId_shiprocketId: { connectionId, shiprocketId } },
    create: {
      connectionId,
      shiprocketId,
      channelOrderId: order.channel_order_id ?? null,
      status: order.status ?? null,
      statusCode: order.status_code ?? null,
      paymentMethod: order.payment_method ?? null,
      total: order.total ? new Decimal(order.total) : null,
      orderDate: order.order_date ? new Date(order.order_date) : null,
      channelName: order.channel_name ?? null,
      rawJson: order as object,
    },
    update: {
      channelOrderId: order.channel_order_id ?? null,
      status: order.status ?? null,
      statusCode: order.status_code ?? null,
      paymentMethod: order.payment_method ?? null,
      total: order.total ? new Decimal(order.total) : null,
      orderDate: order.order_date ? new Date(order.order_date) : null,
      channelName: order.channel_name ?? null,
      rawJson: order as object,
      syncedAt: new Date(),
    },
  })
}

async function upsertShipment(connectionId: string, s: ShiprocketShipmentRow) {
  const shipmentId = String(s.id)
  await prisma.shiprocketShipment.upsert({
    where: { connectionId_shipmentId: { connectionId, shipmentId } },
    create: {
      connectionId,
      shipmentId,
      orderId: s.order_id ? String(s.order_id) : null,
      status: s.status ?? null,
      statusCode: s.status_code ?? null,
      courierName: s.courier_name ?? null,
      awbCode: s.awb_code ?? null,
      isCod: !!s.is_cod,
      codAmount: s.cod_amount ? new Decimal(s.cod_amount) : null,
      shippedAt: s.shipped_date ? new Date(s.shipped_date) : null,
      deliveredAt: s.delivered_date ? new Date(s.delivered_date) : null,
      rtoInitiatedAt: s.rto_initiated_date ? new Date(s.rto_initiated_date) : null,
      charges: s.charges ? new Decimal(s.charges) : null,
      rawJson: s as object,
    },
    update: {
      orderId: s.order_id ? String(s.order_id) : null,
      status: s.status ?? null,
      statusCode: s.status_code ?? null,
      courierName: s.courier_name ?? null,
      awbCode: s.awb_code ?? null,
      isCod: !!s.is_cod,
      codAmount: s.cod_amount ? new Decimal(s.cod_amount) : null,
      shippedAt: s.shipped_date ? new Date(s.shipped_date) : null,
      deliveredAt: s.delivered_date ? new Date(s.delivered_date) : null,
      rtoInitiatedAt: s.rto_initiated_date ? new Date(s.rto_initiated_date) : null,
      charges: s.charges ? new Decimal(s.charges) : null,
      rawJson: s as object,
      syncedAt: new Date(),
    },
  })
}
