import type { PrismaClient } from '@prisma/client'
import { buildShiprocketDateRangeWhere, getEffectiveShipmentDate } from '@/lib/shiprocket-list'
import {
  forwardChargesFromRaw,
  rtoChargesFromRaw,
  codChargesFromRaw,
  totalChargesFromRaw,
} from '@/lib/shiprocket-charges'
import { getCourierName, isCodShipment } from '@/lib/shiprocket-normalize'
import type { PageContext, CompressedDailyRow } from './types'

function computePriorPeriod(from: Date, to: Date) {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

export type LogisticsCourierSummary = {
  courierName: string
  count: number
  deliveredCount: number
  rtoCount: number
  deliveryRate: number | null
  rtoRate: number | null
  totalCharges: number
  avgCostPerShipment: number | null
}

async function computeLogisticsData(
  prisma: PrismaClient,
  shiprocketConnectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<{
  summary: Record<string, number | null>
  daily: CompressedDailyRow[]
  couriers: LogisticsCourierSummary[]
}> {
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
      shippedAt: true,
      shiprocketCreatedAt: true,
      syncedAt: true,
    },
  })

  if (shipments.length === 0) {
    return { summary: {}, daily: [], couriers: [] }
  }

  let deliveredCount = 0
  let rtoCount = 0
  let codCount = 0
  let prepaidCount = 0
  let forwardChargesTotal = 0
  let codChargesTotal = 0
  let rtoChargesTotal = 0

  const dailyMap = new Map<string, {
    shipments: number
    delivered: number
    rto: number
    forwardCharges: number
    rtoCharges: number
    totalCharges: number
  }>()

  const courierMap = new Map<string, {
    count: number
    delivered: number
    rto: number
    totalCharges: number
  }>()

  for (const s of shipments) {
    const isDelivered = (s.status ?? '').toUpperCase().includes('DELIVER')
    const isRto = (s.status ?? '').toUpperCase().includes('RTO')
    const isCod = isCodShipment(s)

    if (isDelivered) deliveredCount++
    if (isRto) rtoCount++
    if (isCod) codCount++
    else prepaidCount++

    const fwd = forwardChargesFromRaw(s.rawJson)
    const cod = codChargesFromRaw(s.rawJson)
    const rto = rtoChargesFromRaw(s.rawJson)
    const total = fwd + cod + rto

    forwardChargesTotal += fwd
    codChargesTotal += cod
    rtoChargesTotal += rto

    // Daily grouping by effective shipment date
    const effectiveDate = getEffectiveShipmentDate(s)
    if (effectiveDate) {
      const dateStr = effectiveDate.toISOString().slice(0, 10)
      const dayEntry = dailyMap.get(dateStr)
      if (dayEntry) {
        dayEntry.shipments++
        if (isDelivered) dayEntry.delivered++
        if (isRto) dayEntry.rto++
        dayEntry.forwardCharges += fwd
        dayEntry.rtoCharges += rto
        dayEntry.totalCharges += total
      } else {
        dailyMap.set(dateStr, {
          shipments: 1,
          delivered: isDelivered ? 1 : 0,
          rto: isRto ? 1 : 0,
          forwardCharges: fwd,
          rtoCharges: rto,
          totalCharges: total,
        })
      }
    }

    // Courier grouping
    const courier = getCourierName(s)
    const cEntry = courierMap.get(courier)
    if (cEntry) {
      cEntry.count++
      if (isDelivered) cEntry.delivered++
      if (isRto) cEntry.rto++
      cEntry.totalCharges += total
    } else {
      courierMap.set(courier, {
        count: 1,
        delivered: isDelivered ? 1 : 0,
        rto: isRto ? 1 : 0,
        totalCharges: total,
      })
    }
  }

  const totalShipments = shipments.length
  const totalShiprocketCharges = forwardChargesTotal + codChargesTotal + rtoChargesTotal
  const deliveredPercent = totalShipments > 0
    ? Math.round((deliveredCount / totalShipments) * 10000) / 100
    : null
  const rtoPercent = totalShipments > 0
    ? Math.round((rtoCount / totalShipments) * 10000) / 100
    : null
  const avgCostPerShipment = totalShipments > 0
    ? Math.round((totalShiprocketCharges / totalShipments) * 100) / 100
    : null
  const codPercent = totalShipments > 0
    ? Math.round((codCount / totalShipments) * 10000) / 100
    : null

  const summary: Record<string, number | null> = {
    totalShipments,
    deliveredCount,
    deliveredPercent,
    rtoCount,
    rtoPercent,
    codCount,
    prepaidCount,
    codPercent,
    forwardCharges: Math.round(forwardChargesTotal * 100) / 100,
    codCharges: Math.round(codChargesTotal * 100) / 100,
    rtoCharges: Math.round(rtoChargesTotal * 100) / 100,
    totalShiprocketCharges: Math.round(totalShiprocketCharges * 100) / 100,
    avgCostPerShipment,
  }

  // Daily rows capped at 30
  const daily: CompressedDailyRow[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, d]) => ({
      date,
      shipments: d.shipments,
      delivered: d.delivered,
      rto: d.rto,
      rtoRate: d.shipments > 0 ? Math.round((d.rto / d.shipments) * 10000) / 100 : 0,
      forwardCharges: Math.round(d.forwardCharges * 100) / 100,
      rtoCharges: Math.round(d.rtoCharges * 100) / 100,
      totalCharges: Math.round(d.totalCharges * 100) / 100,
    }))

  // Couriers sorted by volume
  const couriers: LogisticsCourierSummary[] = Array.from(courierMap.entries())
    .map(([courierName, c]) => ({
      courierName,
      count: c.count,
      deliveredCount: c.delivered,
      rtoCount: c.rto,
      deliveryRate: c.count > 0 ? Math.round((c.delivered / c.count) * 10000) / 100 : null,
      rtoRate: c.count > 0 ? Math.round((c.rto / c.count) * 10000) / 100 : null,
      totalCharges: Math.round(c.totalCharges * 100) / 100,
      avgCostPerShipment: c.count > 0 ? Math.round((c.totalCharges / c.count) * 100) / 100 : null,
    }))
    .sort((a, b) => b.count - a.count)

  return { summary, daily, couriers }
}

export async function buildLogisticsContext(
  prisma: PrismaClient,
  workspaceId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<PageContext> {
  const priorRange = computePriorPeriod(dateFrom, dateTo)

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      id: true,
      shiprocketConnection: {
        select: { id: true, status: true },
      },
    },
  })

  const empty: PageContext = {
    page: 'logistics',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: {},
    priorSummary: {},
    daily: [],
    currency: 'INR',
  }

  const srConn = workspace.shiprocketConnection?.status === 'CONNECTED'
    ? workspace.shiprocketConnection
    : null

  if (!srConn) return empty

  const [current, prior] = await Promise.all([
    computeLogisticsData(prisma, srConn.id, dateFrom, dateTo),
    computeLogisticsData(prisma, srConn.id, priorRange.from, priorRange.to),
  ])

  return {
    page: 'logistics',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: current.summary,
    priorSummary: prior.summary,
    daily: current.daily,
    currency: 'INR',
    extra: {
      couriers: current.couriers,
      priorCouriers: prior.couriers,
    },
  }
}
