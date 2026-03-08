/**
 * Orders & RTO calculator for AI context.
 * Extracts RTO + prepaid metrics from shopify-analytics logic.
 */
import type { PrismaClient } from '@prisma/client'
import type { AiOrdersData } from './types'

const RTO_STATUS_CODES = [9, 10, 14, 20, 40, 41, 46]

export async function calcOrders(
  prisma: PrismaClient,
  connectionId: string,
  workspaceId: string,
  fromDate: Date,
  toDate: Date,
): Promise<AiOrdersData> {

  // Prepaid vs COD
  const orderCounts = await prisma.shopifyOrder.groupBy({
    by: ['financialStatus'],
    where: { connectionId, processedAt: { gte: fromDate, lte: toDate } },
    _count: { id: true },
  })

  let prepaidOrders = 0
  let totalOrders = 0
  for (const g of orderCounts) {
    totalOrders += g._count.id
    if (g.financialStatus?.toLowerCase() === 'paid') prepaidOrders += g._count.id
  }
  const codOrders = totalOrders - prepaidOrders
  const prepaidPercentage = totalOrders > 0
    ? Math.round((prepaidOrders / totalOrders) * 10000) / 100
    : null

  // RTO from Shiprocket
  const srConn = await prisma.shiprocketConnection.findFirst({
    where: { workspaceId, status: 'CONNECTED' },
    select: { id: true },
  })

  let rtoOrders = 0
  let rtoPercent: number | null = null
  let rtoValue = 0
  let totalShipments = 0

  if (srConn) {
    const allShipments = await prisma.shiprocketShipment.findMany({
      where: {
        connectionId: srConn.id,
        shippedAt: { gte: fromDate, lte: toDate },
      },
      select: {
        trackingStatusCode: true, statusCode: true,
        channelOrderId: true,
      },
    })

    totalShipments = allShipments.length

    const rtoShipments = allShipments.filter((s) => {
      const code = s.trackingStatusCode ?? s.statusCode
      return code != null && RTO_STATUS_CODES.includes(code)
    })
    rtoOrders = rtoShipments.length
    rtoPercent = totalShipments > 0
      ? Math.round((rtoOrders / totalShipments) * 10000) / 100
      : null

    // Match RTO to Shopify orders to get value
    const channelIds = rtoShipments
      .map(s => s.channelOrderId)
      .filter((id): id is string => id != null && id !== '')

    if (channelIds.length > 0) {
      const cleanIds = channelIds.map(id => id.replace(/^#/, ''))
      const matchedOrders = await prisma.shopifyOrder.findMany({
        where: {
          connectionId,
          OR: [
            { orderNumber: { in: cleanIds } },
            { name: { in: channelIds } },
          ],
        },
        select: { totalPrice: true },
      })
      rtoValue = matchedOrders.reduce((sum, o) => sum + Number(o.totalPrice), 0)
    }
  }

  return {
    summary: {
      totalOrders,
      prepaidOrders,
      prepaidPercentage,
      codOrders,
      rtoOrders,
      rtoPercent,
      rtoValue,
      totalShipments,
      shiprocketConnected: !!srConn,
    },
  }
}
