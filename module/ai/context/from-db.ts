import type { PrismaClient } from '@prisma/client'
import type {
  DailyMetricRow,
  WorkspaceMetricsContext,
  WorkspaceMetricsSummary,
} from '../types'

const toNum = (v: unknown): number => (v != null ? Number(v) : 0)
const toNumOrNull = (v: unknown): number | null =>
  v != null && v !== '' ? Number(v) : null

/**
 * Load workspace_daily_metrics for a date range and build daily rows + summary.
 * Fetches all columns from DB including cm1, cm2, cm3 per day. No select = full row.
 */
export async function loadWorkspaceMetricsFromDb(
  prisma: PrismaClient,
  workspaceId: string,
  from: Date,
  to: Date
): Promise<WorkspaceMetricsContext> {
  const fromStr = from.toISOString().slice(0, 10)
  const toStr = to.toISOString().slice(0, 10)
  const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1

  const rows = await prisma.workspaceDailyMetrics.findMany({
    where: {
      workspaceId,
      date: { gte: from, lte: to },
    },
    orderBy: { date: 'asc' },
  })

  const daily: DailyMetricRow[] = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    netSales: toNum(r.netSales),
    grossSales: toNum(r.grossSales),
    totalTax: toNum(r.totalTax),
    totalDiscount: toNum(r.totalDiscount),
    ordersCount: r.ordersCount ?? 0,
    aov: toNum(r.aov),
    currency: r.currency ?? 'INR',
    cogs: toNum(r.cogs),
    shipping: toNum(r.shipping),
    packaging: toNum(r.packaging),
    websiteCharges: toNum(r.websiteCharges),
    cm1: toNum(r.cm1),
    metaAdSpend: toNum(r.metaAdSpend),
    googleAdSpend: toNum(r.googleAdSpend),
    totalAdSpend: toNum(r.totalAdSpend),
    cm2: toNum(r.cm2),
    miscExpensesProrated: toNum(r.miscExpensesProrated),
    cm3: toNum(r.cm3),
    acos: toNumOrNull(r.acos),
    blendedRoas: toNumOrNull(r.blendedRoas),
    sessions: r.sessions,
    conversionRate: toNumOrNull(r.conversionRate),
    rtoOrders: r.rtoOrders,
    rtoValue: toNumOrNull(r.rtoValue),
    rtoPercent: toNumOrNull(r.rtoPercent),
    rtoMapped: r.rtoMapped,
    rtoUnmapped: r.rtoUnmapped,
    totalShipments: r.totalShipments,
    prepaidOrdersCount: r.prepaidOrdersCount,
    prepaidPercentage: toNumOrNull(r.prepaidPercentage),
  }))

  let summary: WorkspaceMetricsSummary | null = null
  if (daily.length > 0) {
    const totalNetSales = daily.reduce((s, d) => s + d.netSales, 0)
    const totalGrossSales = daily.reduce((s, d) => s + d.grossSales, 0)
    const totalOrders = daily.reduce((s, d) => s + d.ordersCount, 0)
    const totalAdSpend = daily.reduce((s, d) => s + d.totalAdSpend, 0)
    const totalMeta = daily.reduce((s, d) => s + d.metaAdSpend, 0)
    const totalGoogle = daily.reduce((s, d) => s + d.googleAdSpend, 0)
    const totalCogs = daily.reduce((s, d) => s + d.cogs, 0)
    const totalShipping = daily.reduce((s, d) => s + d.shipping, 0)
    const totalPackaging = daily.reduce((s, d) => s + d.packaging, 0)
    const totalWebsite = daily.reduce((s, d) => s + d.websiteCharges, 0)
    const cm1 = daily.reduce((s, d) => s + d.cm1, 0)
    const cm2 = daily.reduce((s, d) => s + d.cm2, 0)
    const cm3 = daily.reduce((s, d) => s + d.cm3, 0)
    const misc = daily.reduce((s, d) => s + d.miscExpensesProrated, 0)
    const sessionsSum = daily.reduce((s, d) => s + (d.sessions ?? 0), 0)
    const convRates = daily.filter((d) => d.conversionRate != null).map((d) => d.conversionRate!)
    const rtoOrders = daily.reduce((s, d) => s + (d.rtoOrders ?? 0), 0)
    const rtoValue = daily.reduce((s, d) => s + (d.rtoValue ?? 0), 0)
    const totalShipments = daily.reduce((s, d) => s + (d.totalShipments ?? 0), 0)
    const prepaidOrders = daily.reduce((s, d) => s + (d.prepaidOrdersCount ?? 0), 0)
    const currency = daily[0]?.currency ?? 'INR'
    summary = {
      totalNetSales,
      totalGrossSales,
      totalOrders,
      avgAov: totalOrders > 0 ? totalNetSales / totalOrders : 0,
      totalCogs,
      totalShipping,
      totalPackaging,
      totalWebsiteCharges: totalWebsite,
      cm1,
      totalMetaAdSpend: totalMeta,
      totalGoogleAdSpend: totalGoogle,
      totalAdSpend,
      cm2,
      miscExpensesProrated: misc,
      cm3,
      blendedRoas: totalAdSpend > 0 ? totalNetSales / totalAdSpend : null,
      acos: totalNetSales > 0 ? (totalAdSpend / totalNetSales) * 100 : null,
      currency,
      totalSessions: sessionsSum > 0 ? sessionsSum : null,
      avgConversionRate:
        convRates.length > 0
          ? convRates.reduce((a, b) => a + b, 0) / convRates.length
          : null,
      rtoOrders: totalShipments > 0 ? rtoOrders : null,
      rtoValue: totalShipments > 0 ? rtoValue : null,
      rtoPercent:
        totalShipments > 0 ? (rtoOrders / totalShipments) * 100 : null,
      totalShipments: totalShipments > 0 ? totalShipments : null,
      prepaidOrdersCount: totalOrders > 0 ? prepaidOrders : null,
      prepaidPercentage: totalOrders > 0 ? (prepaidOrders / totalOrders) * 100 : null,
    }
  }

  return {
    period: { from: fromStr, to: toStr, days },
    daily,
    summary,
  }
}
