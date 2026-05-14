import type { PrismaClient } from '@prisma/client'
import { computeAcquisition } from '@/lib/acquisition/compute'
import type { PageContext, DateRange, CompressedDailyRow } from './types'

// We import the cohort compute function directly
import { computeCohorts } from '@/lib/cohorts/compute'

function computePriorPeriod(from: Date, to: Date): DateRange {
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  priorTo.setUTCHours(23, 59, 59, 999)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  priorFrom.setUTCHours(0, 0, 0, 0)
  return { from: priorFrom, to: priorTo }
}

/**
 * Builds cohort context for AI insight generation.
 * Uses CM3 metric in cumulative mode — the most informative for AI analysis.
 * Instead of daily rows, we send cohort rows (one per month).
 */
export async function buildCohortsContext(
  prisma: PrismaClient,
  workspaceId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<PageContext> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      shopifyConnections: { where: { status: 'CONNECTED' }, select: { id: true }, take: 1 },
      cogsSettings: true,
      meta_ads_connections: {
        select: { id: true, selected_ad_account_ids: true, selected_ad_account_id: true },
      },
      google_ads_connections: {
        select: { id: true, selected_customer_ids: true, selected_customer_id: true },
      },
    },
  })

  const connectionId = workspace.shopifyConnections[0]?.id
  const priorRange = computePriorPeriod(dateFrom, dateTo)

  if (!connectionId) {
    return {
      page: 'cohorts',
      workspaceId,
      dateRange: { from: dateFrom, to: dateTo },
      priorDateRange: priorRange,
      summary: {},
      priorSummary: {},
      daily: [],
      currency: 'INR',
    }
  }

  const fromStr = dateFrom.toISOString().slice(0, 10)
  const toStr = dateTo.toISOString().slice(0, 10)
  const priorFromStr = priorRange.from.toISOString().slice(0, 10)
  const priorToStr = priorRange.to.toISOString().slice(0, 10)

  // Fetch CM3 cumulative cohorts for current and prior period
  const [currentCm3, priorCm3, currentRepeat] = await Promise.all([
    computeCohorts(prisma, workspace as any, {
      from: fromStr, to: toStr, metric: 'cm3', mode: 'cumulative',
    }),
    computeCohorts(prisma, workspace as any, {
      from: priorFromStr, to: priorToStr, metric: 'cm3', mode: 'cumulative',
    }),
    // Also get repeat rates — crucial for cohort insight quality
    computeCohorts(prisma, workspace as any, {
      from: fromStr, to: toStr, metric: 'repeat', mode: 'post',
    }),
  ])

  const cs = currentCm3.summary
  const ps = priorCm3.summary

  // Summary: aggregate cohort health metrics
  const summary: Record<string, number | null> = {
    newCustomers: cs.newCustomers,
    averageCac: Math.round(cs.averageCac),
    avg90DayRepeat: Math.round(cs.avg90DayRepeat * 1000) / 10, // as %
    averagePayback: cs.averagePayback,
    cohortCount: currentCm3.rows.length,
  }

  const priorSummary: Record<string, number | null> = {
    newCustomers: ps.newCustomers,
    averageCac: Math.round(ps.averageCac),
    avg90DayRepeat: Math.round(ps.avg90DayRepeat * 1000) / 10,
    averagePayback: ps.averagePayback,
    cohortCount: priorCm3.rows.length,
  }

  // Build cohort rows as "daily" — one row per cohort month
  // Include both CM3 cumulative and repeat rate data
  const repeatMap = new Map(
    currentRepeat.rows.map(r => [r.cohortMonth, r])
  )

  const cohortRows: CompressedDailyRow[] = currentCm3.rows
    .filter(r => r.newCustomers > 0)
    .map(r => {
      const rr = repeatMap.get(r.cohortMonth)
      return {
        date: r.cohortMonth,
        nc: r.newCustomers,
        cac: Math.round(r.cac),
        rr90: Math.round(r.rr90 * 1000) / 10,
        payback: r.payback ?? -1, // -1 = not reached
        firstOrder: Math.round(r.firstOrderR),
        // Cumulative CM3 at M3, M6, M12 milestones (compressed — skip intermediate months)
        cm3M3: Math.round(r.m3),
        cm3M6: Math.round(r.m6),
        cm3M12: Math.round(r.m12),
        // Repeat rates at key milestones
        repeatM3: rr ? Math.round((rr.m1 + rr.m2 + rr.m3) * 1000) / 10 : 0,
        repeatM6: rr ? Math.round((rr.m1 + rr.m2 + rr.m3 + rr.m4 + rr.m5 + rr.m6) * 1000) / 10 : 0,
      }
    })

  // Cap to most recent 18 cohort months
  const cappedRows = cohortRows.length > 18 ? cohortRows.slice(-18) : cohortRows

  return {
    page: 'cohorts',
    workspaceId,
    dateRange: { from: dateFrom, to: dateTo },
    priorDateRange: priorRange,
    summary,
    priorSummary,
    daily: cappedRows,
    currency: currentCm3.currency ?? 'INR',
  }
}
