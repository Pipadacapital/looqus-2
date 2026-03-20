/**
 * Shared RTO summary for analytics. Uses effective shipment date and optional workspace order filters.
 * Single place for RTO counts/value so analytics stay consistent.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { RTO_STATUS_CODES } from './constants'
import { buildShiprocketDateRangeWhere } from '@/lib/shiprocket-list'

export type RtoSummaryResult = {
  totalShipments: number
  rtoOrders: number
  rtoPercent: number | null
  rtoValue: number
  rtoMapped: number
  rtoUnmapped: number
}

/**
 * Get RTO summary for a workspace in a date range.
 * When orderInclusionWhere is provided, rtoOrders/rtoValue/rtoMapped are filter-consistent
 * (only RTO shipments whose matched Shopify order passes the workspace filter).
 */
export async function getRtoSummary(
  prisma: PrismaClient,
  connectionId: string,
  shiprocketConnectionId: string,
  fromDate: Date,
  toDate: Date,
  orderInclusionWhere?: Prisma.ShopifyOrderWhereInput
): Promise<RtoSummaryResult> {
  const dateWhere = buildShiprocketDateRangeWhere(fromDate, toDate)
  const allShipments = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId: shiprocketConnectionId,
      ...dateWhere,
    },
    select: {
      trackingStatusCode: true,
      statusCode: true,
      channelOrderId: true,
    },
  })

  const totalShipments = allShipments.length
  const rtoShipments = allShipments.filter((s) => {
    const code = s.trackingStatusCode ?? s.statusCode
    return code != null && (RTO_STATUS_CODES as readonly number[]).includes(code)
  })

  const channelIds = rtoShipments
    .map((s) => s.channelOrderId)
    .filter((id): id is string => id != null && id !== '')

  if (channelIds.length === 0) {
    return {
      totalShipments,
      rtoOrders: 0,
      rtoPercent: totalShipments > 0 ? 0 : null,
      rtoValue: 0,
      rtoMapped: 0,
      rtoUnmapped: 0,
    }
  }

  const cleanIds = channelIds.map((id) => id.replace(/^#/, ''))
  const where: Prisma.ShopifyOrderWhereInput = {
    connectionId,
    OR: [
      { orderNumber: { in: cleanIds } },
      { name: { in: channelIds } },
    ],
    ...orderInclusionWhere,
  }

  const matchedOrders = await prisma.shopifyOrder.findMany({
    where,
    select: { totalPrice: true, orderNumber: true, name: true },
  })

  const rtoValue = matchedOrders.reduce((sum, o) => sum + Number(o.totalPrice), 0)
  const rtoMapped = matchedOrders.length
  // When filter is applied, rtoOrders = count of RTO that matched filtered orders (filter-consistent).
  const rtoOrders = orderInclusionWhere != null ? rtoMapped : rtoShipments.length
  const rtoUnmapped = rtoShipments.length - rtoMapped
  const rtoPercent =
    totalShipments > 0 ? Math.round((rtoOrders / totalShipments) * 10000) / 100 : null

  return {
    totalShipments,
    rtoOrders,
    rtoPercent,
    rtoValue,
    rtoMapped,
    rtoUnmapped,
  }
}
