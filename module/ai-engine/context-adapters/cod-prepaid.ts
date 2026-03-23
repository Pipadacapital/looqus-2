import type { PrismaClient } from '@prisma/client'
import { buildShiprocketDateRangeWhere, getEffectiveShipmentDate } from '@/lib/shiprocket-list'
import { getCodPrepaidAnalytics } from '@/lib/workspace-metrics'
import { isCodShipment } from '@/lib/shiprocket-normalize'
import type { PageContext, CompressedDailyRow } from './types'

/** Default fee assumptions for AI context — same as UI defaults */
const DEFAULT_FEES = {
  codFeePerOrder: 30,
  gatewayFeePercent: 2,
  returnShippingPerRto: 80,
}

function computePriorPeriod(from: Date, to: Date) {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

async function buildDailyBreakdown(
  prisma: PrismaClient,
  shiprocketConnectionId: string,
  fromDate: Date,
  toDate: Date
): Promise<CompressedDailyRow[]> {
  const dateWhere = buildShiprocketDateRangeWhere(fromDate, toDate)
  const shipments = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId: shiprocketConnectionId,
      ...dateWhere,
    },
    select: {
      status: true,
      isCod: true,
      paymentMethod: true,
      rawJson: true,
      shippedAt: true,
      shiprocketCreatedAt: true,
      syncedAt: true,
    },
  })

  const dailyMap = new Map<string, {
    codOrders: number
    prepaidOrders: number
    codRto: number
    prepaidRto: number
  }>()

  for (const s of shipments) {
    const isRto = (s.status ?? '').toUpperCase().includes('RTO')
    const isCod = isCodShipment(s)
    const effectiveDate = getEffectiveShipmentDate(s)
    if (!effectiveDate) continue

    const dateStr = effectiveDate.toISOString().slice(0, 10)
    const entry = dailyMap.get(dateStr) ?? { codOrders: 0, prepaidOrders: 0, codRto: 0, prepaidRto: 0 }

    if (isCod) {
      entry.codOrders++
      if (isRto) entry.codRto++
    } else {
      entry.prepaidOrders++
      if (isRto) entry.prepaidRto++
    }

    dailyMap.set(dateStr, entry)
  }

  return Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, d]) => ({
      date,
      codOrders: d.codOrders,
      prepaidOrders: d.prepaidOrders,
      codRto: d.codRto,
      prepaidRto: d.prepaidRto,
      codRtoRate: d.codOrders > 0 ? Math.round((d.codRto / d.codOrders) * 10000) / 100 : 0,
      prepaidRtoRate: d.prepaidOrders > 0 ? Math.round((d.prepaidRto / d.prepaidOrders) * 10000) / 100 : 0,
    }))
}

function extractSummary(result: Awaited<ReturnType<typeof getCodPrepaidAnalytics>>): Record<string, number | null> {
  const totalOrders = result.codOrders + result.prepaidOrders
  const codRow = result.comparisonTable.find(r => r.paymentMethod === 'COD')
  const prepaidRow = result.comparisonTable.find(r => r.paymentMethod === 'Prepaid')

  return {
    codOrders: result.codOrders,
    prepaidOrders: result.prepaidOrders,
    totalOrders,
    codPercent: totalOrders > 0 ? Math.round((result.codOrders / totalOrders) * 10000) / 100 : null,
    codRtoRatePercent: result.codRtoRatePercent,
    prepaidRtoRatePercent: result.prepaidRtoRatePercent,
    codRealizationRatePercent: result.codRealizationRatePercent,
    effectiveRevenueCod: result.effectiveRevenueCod,
    effectiveRevenuePrepaid: result.effectiveRevenuePrepaid,
    prepaidPremium: result.prepaidPremium,
    averageOrderValue: result.averageOrderValue,
    breakEvenCodRtoRatePercent: result.breakEvenCodRtoRatePercent,
    netRevenuePerOrderCod: codRow?.netRevenuePerOrder ?? null,
    netRevenuePerOrderPrepaid: prepaidRow?.netRevenuePerOrder ?? null,
    grossRevenueCod: codRow?.grossRevenue ?? null,
    grossRevenuePrepaid: prepaidRow?.grossRevenue ?? null,
  }
}

export async function buildCodPrepaidContext(
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
    page: 'cod-prepaid',
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

  const [current, prior, daily] = await Promise.all([
    getCodPrepaidAnalytics(prisma, srConn.id, dateFrom, dateTo, DEFAULT_FEES),
    getCodPrepaidAnalytics(prisma, srConn.id, priorRange.from, priorRange.to, DEFAULT_FEES),
    buildDailyBreakdown(prisma, srConn.id, dateFrom, dateTo),
  ])

  return {
    page: 'cod-prepaid',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: extractSummary(current),
    priorSummary: extractSummary(prior),
    daily,
    currency: 'INR',
    extra: {
      breakEvenNote: current.breakEvenNote,
      feesUsed: DEFAULT_FEES,
      comparisonTable: current.comparisonTable,
    },
  }
}
