/**
 * COD vs Prepaid Analytics (PR4).
 * Shiprocket-first: payment method and RTO/delivered from Shiprocket; order value from Shiprocket (cod_amount / order total).
 * Uses configurable fees (COD fee, gateway fee, return shipping per RTO) for effective revenue and break-even.
 */
import type { PrismaClient } from '@prisma/client'
import { buildShiprocketDateRangeWhere } from '@/lib/shiprocket-list'
import { rtoChargesFromRaw, shiprocketRtoRevenueLost } from '@/lib/shiprocket-charges'
import { isCodShipment } from '@/lib/shiprocket-normalize'

export type CodPrepaidFeeInputs = {
  /** COD handling fee per order, flat ₹ (e.g. 30). */
  codFeePerOrder: number
  /** Payment gateway fee for prepaid, as % of prepaid gross revenue (e.g. 2 for 2%). */
  gatewayFeePercent: number
  /** Return shipping cost per RTO shipment, ₹ (e.g. 80). RS in spec; restocking omitted for now. */
  returnShippingPerRto: number
}

export type CodPrepaidRow = {
  paymentMethod: 'COD' | 'Prepaid'
  orders: number
  grossRevenue: number
  rtoRatePercent: number | null
  effectiveRevenue: number
  /** Total fee (COD fee or Gateway fee for the segment). */
  feeTotal: number
  /** Net revenue = effective revenue (after RTO loss and fees). */
  netRevenue: number
  netRevenuePerOrder: number | null
}

export type CodPrepaidAnalyticsResult = {
  from: string
  to: string
  codOrders: number
  prepaidOrders: number
  codRealizationRatePercent: number | null
  codRtoRatePercent: number | null
  prepaidRtoRatePercent: number | null
  effectiveRevenueCod: number
  effectiveRevenuePrepaid: number
  prepaidPremium: number
  /** Break-even COD RTO rate (above this, prepaid is better at current AOV and fees). Null if unavailable. */
  breakEvenCodRtoRatePercent: number | null
  /** When break-even cannot be shown as a rate (e.g. prepaid always better), human-readable reason. */
  breakEvenNote: string | null
  comparisonTable: CodPrepaidRow[]
  /** Average order value (all shipments) for break-even calc. */
  averageOrderValue: number | null
}

function isRtoByStatus(status: string | null): boolean {
  return (status ?? '').toUpperCase().includes('RTO')
}

function isDeliveredByStatus(status: string | null): boolean {
  return (status ?? '').toUpperCase().includes('DELIVER')
}

/**
 * COD vs Prepaid analytics for a date range. Shiprocket-first; fees passed in for effective revenue.
 */
export async function getCodPrepaidAnalytics(
  prisma: PrismaClient,
  shiprocketConnectionId: string,
  fromDate: Date,
  toDate: Date,
  fees: CodPrepaidFeeInputs
): Promise<CodPrepaidAnalyticsResult> {
  const fromStr = fromDate.toISOString().slice(0, 10)
  const toStr = toDate.toISOString().slice(0, 10)
  const dateWhere = buildShiprocketDateRangeWhere(fromDate, toDate)

  const shipments = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId: shiprocketConnectionId,
      ...dateWhere,
    },
    select: {
      status: true,
      orderId: true,
      isCod: true,
      codAmount: true,
      rawJson: true,
    },
  })

  const orderIds = [...new Set(shipments.map((s) => s.orderId).filter(Boolean))] as string[]
  const orderTotals = new Map<string, number>()
  if (orderIds.length > 0) {
    const orders = await prisma.shiprocketOrder.findMany({
      where: { connectionId: shiprocketConnectionId, shiprocketId: { in: orderIds } },
      select: { shiprocketId: true, total: true },
    })
    for (const o of orders) {
      const t = o.total != null ? Number(o.total) : null
      if (t != null && t > 0) orderTotals.set(o.shiprocketId, t)
    }
  }

  let codOrders = 0
  let prepaidOrders = 0
  let codDelivered = 0
  let prepaidDelivered = 0
  let codRto = 0
  let prepaidRto = 0
  let grossRevenueCod = 0
  let grossRevenuePrepaid = 0
  let rtoCostCod = 0
  let rtoCostPrepaid = 0

  for (const s of shipments) {
    const isCod = isCodShipment(s)
    const isRto = isRtoByStatus(s.status)
    const isDelivered = isDeliveredByStatus(s.status)
    const codAmount = s.codAmount != null ? Number(s.codAmount) : null
    const orderTotal = s.orderId ? orderTotals.get(s.orderId) ?? null : null
    const orderValue = shiprocketRtoRevenueLost(
      { codAmount, isCod },
      s.rawJson,
      orderTotal
    )

    if (isCod) {
      codOrders++
      if (isDelivered) codDelivered++
      if (isRto) {
        codRto++
        rtoCostCod += rtoChargesFromRaw(s.rawJson)
      }
      grossRevenueCod += orderValue
    } else {
      prepaidOrders++
      if (isDelivered) prepaidDelivered++
      if (isRto) {
        prepaidRto++
        rtoCostPrepaid += rtoChargesFromRaw(s.rawJson)
      }
      grossRevenuePrepaid += orderValue
    }
  }

  const codRtoRate = codOrders > 0 ? codRto / codOrders : 0
  const prepaidRtoRate = prepaidOrders > 0 ? prepaidRto / prepaidOrders : 0
  const codRealizationRatePercent =
    codOrders > 0 ? Math.round((codDelivered / codOrders) * 10000) / 100 : null
  const codRtoRatePercent = codOrders > 0 ? Math.round(codRtoRate * 10000) / 100 : null
  const prepaidRtoRatePercent = prepaidOrders > 0 ? Math.round(prepaidRtoRate * 10000) / 100 : null

  const codFeeTotal = codOrders * fees.codFeePerOrder
  const gatewayFeeTotal = grossRevenuePrepaid * (fees.gatewayFeePercent / 100)
  const codReturnShippingTotal = codRto * fees.returnShippingPerRto
  const prepaidReturnShippingTotal = prepaidRto * fees.returnShippingPerRto

  const effectiveRevenueCod =
    grossRevenueCod * (1 - codRtoRate) - codFeeTotal - codReturnShippingTotal
  const effectiveRevenuePrepaid =
    grossRevenuePrepaid * (1 - prepaidRtoRate) - gatewayFeeTotal - prepaidReturnShippingTotal
  const prepaidPremium = effectiveRevenuePrepaid - effectiveRevenueCod

  const totalOrders = codOrders + prepaidOrders
  const totalGross = grossRevenueCod + grossRevenuePrepaid
  const averageOrderValue = totalOrders > 0 ? totalGross / totalOrders : null

  const restockingPerRto = 0
  const S = fees.returnShippingPerRto
  const RS = restockingPerRto
  let breakEvenCodRtoRatePercent: number | null = null
  let breakEvenNote: string | null = null
  if (
    averageOrderValue != null &&
    averageOrderValue > 0 &&
    S >= 0 &&
    averageOrderValue + S + RS > 0
  ) {
    const V = averageOrderValue
    const P = prepaidRtoRate
    const COD_fee = fees.codFeePerOrder
    const PG_fee = V * (fees.gatewayFeePercent / 100)
    const numerator = V * P + (COD_fee - PG_fee) + P * (S + RS)
    const denominator = V + S + RS
    const rCodBe = numerator / denominator
    if (rCodBe >= 0 && rCodBe <= 1) {
      breakEvenCodRtoRatePercent = Math.round(rCodBe * 10000) / 100
    } else if (rCodBe < 0) {
      breakEvenNote = 'Prepaid is always better at current AOV and fees.'
    } else {
      breakEvenNote = 'COD is always better at current AOV and fees.'
    }
  } else if (totalOrders === 0 || totalGross <= 0) {
    breakEvenNote = 'No orders in range; set date range and sync Shiprocket.'
  } else if (averageOrderValue == null || averageOrderValue <= 0) {
    breakEvenNote = 'Average order value unavailable.'
  } else {
    breakEvenNote = 'Return shipping cost required for break-even.'
  }

  const round2 = (n: number) => Math.round(n * 100) / 100
  const comparisonTable: CodPrepaidRow[] = [
    {
      paymentMethod: 'COD',
      orders: codOrders,
      grossRevenue: round2(grossRevenueCod),
      rtoRatePercent: codRtoRatePercent,
      effectiveRevenue: round2(effectiveRevenueCod),
      feeTotal: round2(codFeeTotal + codReturnShippingTotal),
      netRevenue: round2(effectiveRevenueCod),
      netRevenuePerOrder: codOrders > 0 ? round2(effectiveRevenueCod / codOrders) : null,
    },
    {
      paymentMethod: 'Prepaid',
      orders: prepaidOrders,
      grossRevenue: round2(grossRevenuePrepaid),
      rtoRatePercent: prepaidRtoRatePercent,
      effectiveRevenue: round2(effectiveRevenuePrepaid),
      feeTotal: round2(gatewayFeeTotal + prepaidReturnShippingTotal),
      netRevenue: round2(effectiveRevenuePrepaid),
      netRevenuePerOrder: prepaidOrders > 0 ? round2(effectiveRevenuePrepaid / prepaidOrders) : null,
    },
  ]

  return {
    from: fromStr,
    to: toStr,
    codOrders,
    prepaidOrders,
    codRealizationRatePercent,
    codRtoRatePercent,
    prepaidRtoRatePercent,
    effectiveRevenueCod: round2(effectiveRevenueCod),
    effectiveRevenuePrepaid: round2(effectiveRevenuePrepaid),
    prepaidPremium: round2(prepaidPremium),
    breakEvenCodRtoRatePercent,
    breakEvenNote,
    comparisonTable,
    averageOrderValue: averageOrderValue != null ? round2(averageOrderValue) : null,
  }
}
