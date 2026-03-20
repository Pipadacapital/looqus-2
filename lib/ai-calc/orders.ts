/**
 * Orders & RTO calculator for AI context.
 * Uses shared getRtoSummary (effective date, optional workspace order filters).
 */
import type { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import type { AiOrdersData } from './types'
import { getRtoSummary } from '@/lib/workspace-metrics'

export async function calcOrders(
  prisma: PrismaClient,
  connectionId: string,
  workspaceId: string,
  fromDate: Date,
  toDate: Date,
  orderInclusionWhere?: Prisma.ShopifyOrderWhereInput
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

  const srConn = await prisma.shiprocketConnection.findFirst({
    where: { workspaceId, status: 'CONNECTED' },
    select: { id: true },
  })

  let rtoOrders = 0
  let rtoPercent: number | null = null
  let rtoValue = 0
  let totalShipments = 0

  if (srConn) {
    const rto = await getRtoSummary(
      prisma,
      connectionId,
      srConn.id,
      fromDate,
      toDate,
      orderInclusionWhere
    )
    totalShipments = rto.totalShipments
    rtoOrders = rto.rtoOrders
    rtoPercent = rto.rtoPercent
    rtoValue = rto.rtoValue
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
