import type { PrismaClient } from '@prisma/client'
import { computeLtv } from '@/lib/ltv/compute'
import type { PageContext, DateRange, CompressedDailyRow } from './types'

function computePriorPeriod(from: Date, to: Date): DateRange {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

const fmt = (n: number) => Math.round(n)

/**
 * Builds LTV context for AI insight generation.
 * Uses CM2 cumulative (best for payback & value analysis) + repeat_rate (retention depth).
 * Product rows are used as the "daily" series — each row = one product's LTV curve.
 */
export async function buildLtvContext(
  prisma: PrismaClient,
  workspaceId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<PageContext> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
      cogsSettings: true,
      meta_ads_connections: {
        select: { id: true, selected_ad_account_ids: true, selected_ad_account_id: true },
      },
      google_ads_connections: {
        select: { id: true, selected_customer_ids: true, selected_customer_id: true },
      },
      shiprocketConnection: { select: { id: true, status: true } },
    },
  })

  const priorRange = computePriorPeriod(dateFrom, dateTo)
  const fromStr = dateFrom.toISOString().slice(0, 10)
  const toStr = dateTo.toISOString().slice(0, 10)
  const priorFromStr = priorRange.from.toISOString().slice(0, 10)
  const priorToStr = priorRange.to.toISOString().slice(0, 10)

  const empty = (): PageContext => ({
    page: 'lifetime-value',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary: {},
    priorSummary: {},
    daily: [],
    currency: 'INR',
  })

  if (!workspace.shopifyConnections[0]) return empty()

  const ws = workspace as any

  // Fetch CM2 cumulative (main LTV metric) + repeat_rate (retention depth)
  // Both for current and prior period
  const [currentCm2, priorCm2, currentRepeat] = await Promise.all([
    computeLtv(prisma, ws, {
      from: fromStr,
      to: toStr,
      metric: 'cm2',
      mode: 'cumulative',
      dimension: 'product',
      page: 1,
      pageSize: 50, // Get top 50 products for analysis
    }),
    computeLtv(prisma, ws, {
      from: priorFromStr,
      to: priorToStr,
      metric: 'cm2',
      mode: 'cumulative',
      dimension: 'product',
      page: 1,
      pageSize: 50,
    }),
    computeLtv(prisma, ws, {
      from: fromStr,
      to: toStr,
      metric: 'repeat_rate',
      mode: 'post_acq',
      dimension: 'product',
      page: 1,
      pageSize: 50,
    }),
  ])

  const cs = currentCm2.summary
  const ps = priorCm2.summary
  const currency = currentCm2.currency ?? 'INR'

  // --- Summary (period-over-period comparable) ---
  const summary: Record<string, number | null> = {
    newCustomers: cs.newCustomers,
    firstOrderR: fmt(cs.firstOrderR),  // avg repeat revenue in first order window
    firstOrder: fmt(cs.firstOrder),    // avg CM2 on first order
    month1: fmt(cs.month1),            // avg cumulative CM2 at 1 month
    month3: fmt(cs.month3),            // avg cumulative CM2 at 3 months
    month6: fmt(cs.month6),            // avg cumulative CM2 at 6 months
    month12: fmt(cs.month12),          // avg cumulative CM2 at 12 months
    // LTV velocity: how fast value accumulates after first order
    m1ToM3Lift: cs.month1 > 0 ? Math.round((cs.month3 / cs.month1 - 1) * 100) : null,
    m3ToM6Lift: cs.month3 > 0 ? Math.round((cs.month6 / cs.month3 - 1) * 100) : null,
    m6ToM12Lift: cs.month6 > 0 ? Math.round((cs.month12 / cs.month6 - 1) * 100) : null,
  }

  const priorSummary: Record<string, number | null> = {
    newCustomers: ps.newCustomers,
    firstOrderR: fmt(ps.firstOrderR),
    firstOrder: fmt(ps.firstOrder),
    month1: fmt(ps.month1),
    month3: fmt(ps.month3),
    month6: fmt(ps.month6),
    month12: fmt(ps.month12),
    m1ToM3Lift: ps.month1 > 0 ? Math.round((ps.month3 / ps.month1 - 1) * 100) : null,
    m3ToM6Lift: ps.month3 > 0 ? Math.round((ps.month6 / ps.month3 - 1) * 100) : null,
    m6ToM12Lift: ps.month6 > 0 ? Math.round((ps.month12 / ps.month6 - 1) * 100) : null,
  }

  // --- Product-level LTV rows (top 15 by newCustomers) ---
  // Used by anomaly detection to find products with outlier LTV curves
  const repeatMap = new Map(
    currentRepeat.rows.map(r => [r.dimensionValue, r])
  )

  const productRows: CompressedDailyRow[] = currentCm2.rows
    .filter(r => r.newCustomers >= 3) // Only products with meaningful cohort size
    .slice(0, 15)
    .map(r => {
      const rr = repeatMap.get(r.dimensionValue)
      // Retention ratio: M12 CM2 / M1 CM2 — higher = better retention
      const retentionRatio = r.m1 > 0 ? Math.round((r.m12 / r.m1) * 100) / 100 : 0
      // Repeat rate at M3 (percentage of customers who bought again in 3 months)
      const rrM3Pct = rr
        ? Math.round((rr.m1 + rr.m2 + rr.m3) * 1000) / 10
        : 0

      return {
        date: r.dimensionLabel || r.dimensionValue,
        nc: r.newCustomers,
        m1: fmt(r.m1),
        m3: fmt(r.m3),
        m6: fmt(r.m6),
        m12: fmt(r.m12),
        retentionRatio,
        rrM3Pct,
      }
    })

  // --- Extra: ranked product segments for the prompt ---
  const allProducts = currentCm2.rows.filter(r => r.newCustomers >= 3)

  // Top 5 by M12 LTV per customer (highest long-term value)
  const topByM12 = [...allProducts]
    .sort((a, b) => b.m12 - a.m12)
    .slice(0, 5)
    .map(r => ({
      label: r.dimensionLabel || r.dimensionValue,
      nc: r.newCustomers,
      firstOrder: fmt(r.firstOrder),
      m3: fmt(r.m3),
      m6: fmt(r.m6),
      m12: fmt(r.m12),
      retentionRatio: r.m1 > 0 ? Math.round((r.m12 / r.m1) * 100) / 100 : 0,
    }))

  // Bottom 5 by M12 LTV (low long-term value — possible churn risk)
  const bottomByM12 = [...allProducts]
    .filter(r => r.m12 !== 0)
    .sort((a, b) => a.m12 - b.m12)
    .slice(0, 5)
    .map(r => ({
      label: r.dimensionLabel || r.dimensionValue,
      nc: r.newCustomers,
      firstOrder: fmt(r.firstOrder),
      m3: fmt(r.m3),
      m12: fmt(r.m12),
    }))

  // LTV curve: overall average at each month milestone
  const ltvCurve = [
    cs.month1,
    currentCm2.rows.reduce((sum, r) => sum + r.m2, 0) /
      Math.max(1, currentCm2.rows.filter(r => r.newCustomers >= 3).length),
    cs.month3,
    currentCm2.rows.reduce((sum, r) => sum + r.m4, 0) /
      Math.max(1, currentCm2.rows.filter(r => r.newCustomers >= 3).length),
    currentCm2.rows.reduce((sum, r) => sum + r.m5, 0) /
      Math.max(1, currentCm2.rows.filter(r => r.newCustomers >= 3).length),
    cs.month6,
    cs.month12,
  ].map(v => fmt(v))

  return {
    page: 'lifetime-value',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary,
    priorSummary,
    daily: productRows,
    currency,
    extra: {
      topByM12,
      bottomByM12,
      ltvCurve, // [m1, m2, m3, m4, m5, m6, m12]
      totalProducts: allProducts.length,
    },
  }
}
