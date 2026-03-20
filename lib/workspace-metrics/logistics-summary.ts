/**
 * Logistics summary for the Logistics Dashboard.
 * Purely Shiprocket operational: same shipment set and RTO/delivered definitions as the Shiprocket page.
 * No Shopify mapping. Charge breakdown: forward + COD + RTO = total Shiprocket charges.
 */
import type { PrismaClient } from '@prisma/client'
import { buildShiprocketDateRangeWhere } from '@/lib/shiprocket-list'
import {
  forwardChargesFromRaw,
  rtoChargesFromRaw,
  codChargesFromRaw,
  totalChargesFromRaw,
} from '@/lib/shiprocket-charges'
import { getCourierName, isCodShipment } from '@/lib/shiprocket-normalize'

export type LogisticsByCourier = {
  courierName: string
  count: number
  deliveredCount: number
  rtoCount: number
  totalCharges: number
}

export type LogisticsByPaymentMethod = {
  paymentMethod: 'COD' | 'Prepaid'
  count: number
}

export type LogisticsSummaryResult = {
  totalShipments: number
  deliveredCount: number
  deliveredPercent: number | null
  /** RTO shipment count: status contains 'RTO' (same as Shiprocket page). */
  rtoCount: number
  rtoPercent: number | null
  codCount: number
  prepaidCount: number
  /** Sum of forward (outbound) charges from raw_json. */
  forwardCharges: number
  /** Sum of COD charges from raw_json. */
  codCharges: number
  /** Sum of RTO (return) charges from raw_json. */
  rtoCharges: number
  /** forwardCharges + codCharges + rtoCharges. */
  totalShiprocketCharges: number
  averageShippingChargePerShipment: number | null
  byCourier: LogisticsByCourier[]
  byPaymentMethod: LogisticsByPaymentMethod[]
}

/**
 * RTO predicate matching the Shiprocket page: status contains 'RTO' (case-insensitive).
 */
function isRtoByStatus(status: string | null): boolean {
  return (status ?? '').toUpperCase().includes('RTO')
}

/**
 * Delivered predicate matching the Shiprocket page: status contains 'DELIVER' (case-insensitive).
 */
function isDeliveredByStatus(status: string | null): boolean {
  return (status ?? '').toUpperCase().includes('DELIVER')
}

/**
 * Full logistics summary for a date range. Shiprocket-only; same date filter and RTO/delivered
 * definitions as the Shiprocket list page so counts match.
 */
export async function getLogisticsSummary(
  prisma: PrismaClient,
  shiprocketConnectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<LogisticsSummaryResult> {
  const dateWhere = buildShiprocketDateRangeWhere(fromDate, toDate)
  const shipments = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId: shiprocketConnectionId,
      ...dateWhere,
    },
    select: {
      status: true,
      courierName: true,
      isCod: true,
      paymentMethod: true,
      rawJson: true,
    },
  })

  let deliveredCount = 0
  let codCount = 0
  let prepaidCount = 0
  let rtoCount = 0
  let forwardCharges = 0
  let codChargesSum = 0
  let rtoChargesSum = 0
  const courierMap = new Map<
    string,
    { count: number; delivered: number; rto: number; charges: number }
  >()

  for (const s of shipments) {
    const isDelivered = isDeliveredByStatus(s.status)
    const isRto = isRtoByStatus(s.status)
    if (isDelivered) deliveredCount++
    if (isRto) rtoCount++
    if (isCodShipment(s)) codCount++
    else prepaidCount++

    const fwd = forwardChargesFromRaw(s.rawJson)
    const cod = codChargesFromRaw(s.rawJson)
    const rto = rtoChargesFromRaw(s.rawJson)
    forwardCharges += fwd
    codChargesSum += cod
    rtoChargesSum += rto
    const totalRow = totalChargesFromRaw(s.rawJson)

    const courier = getCourierName(s)
    const cur = courierMap.get(courier) ?? {
      count: 0,
      delivered: 0,
      rto: 0,
      charges: 0,
    }
    cur.count++
    if (isDelivered) cur.delivered++
    if (isRto) cur.rto++
    cur.charges += totalRow
    courierMap.set(courier, cur)
  }

  const totalShipments = shipments.length
  const deliveredPercent =
    totalShipments > 0 ? Math.round((deliveredCount / totalShipments) * 10000) / 100 : null
  const rtoPercent =
    totalShipments > 0 ? Math.round((rtoCount / totalShipments) * 10000) / 100 : null
  const totalShiprocketCharges = forwardCharges + codChargesSum + rtoChargesSum
  const averageShippingChargePerShipment =
    totalShipments > 0 ? Math.round((totalShiprocketCharges / totalShipments) * 100) / 100 : null

  const byCourier: LogisticsByCourier[] = Array.from(courierMap.entries())
    .map(([courierName, v]) => ({
      courierName,
      count: v.count,
      deliveredCount: v.delivered,
      rtoCount: v.rto,
      totalCharges: Math.round(v.charges * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count)

  const byPaymentMethod: LogisticsByPaymentMethod[] = [
    { paymentMethod: 'COD', count: codCount },
    { paymentMethod: 'Prepaid', count: prepaidCount },
  ]

  return {
    totalShipments,
    deliveredCount,
    deliveredPercent,
    rtoCount,
    rtoPercent,
    codCount,
    prepaidCount,
    forwardCharges: Math.round(forwardCharges * 100) / 100,
    codCharges: Math.round(codChargesSum * 100) / 100,
    rtoCharges: Math.round(rtoChargesSum * 100) / 100,
    totalShiprocketCharges: Math.round(totalShiprocketCharges * 100) / 100,
    averageShippingChargePerShipment,
    byCourier,
    byPaymentMethod,
  }
}
