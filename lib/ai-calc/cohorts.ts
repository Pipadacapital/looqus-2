/**
 * Cohorts calculator for AI context.
 * Wraps lib/cohorts/compute.ts to get summary-level cohort stats.
 */
import type { PrismaClient } from '@prisma/client'
import type { AiCohortsData } from './types'
import { computeCohorts } from '@/lib/cohorts/compute'

interface CohortWorkspace {
  id: string
  shopifyConnections: { id: string }[]
  meta_ads_connections: {
    id: string
    selected_ad_account_ids: string[] | null
    selected_ad_account_id: string | null
  } | null
  google_ads_connections: {
    id: string
    selected_customer_ids: string[] | null
    selected_customer_id: string | null
  } | null
  shiprocketConnection: { id: string; status: string } | null
}

export async function calcCohorts(
  prisma: PrismaClient,
  workspace: CohortWorkspace,
  fromStr: string,
  toStr: string,
): Promise<AiCohortsData | null> {
  try {
    const result = await computeCohorts(prisma, workspace, {
      from: fromStr,
      to: toStr,
      metric: 'revenue',
      mode: 'cumulative',
    })

    // Find top cohort by repeat rate
    let topCohortMonth: string | null = null
    let topCohortRepeat: number | null = null
    for (const row of result.rows) {
      if (row.rr90 > (topCohortRepeat ?? -1)) {
        topCohortRepeat = row.rr90
        topCohortMonth = row.cohortMonth
      }
    }

    return {
      summary: {
        averageCac: result.summary.averageCac,
        avg90DayRepeat: result.summary.avg90DayRepeat,
        averagePayback: result.summary.averagePayback,
        newCustomers: result.summary.newCustomers,
        topCohortMonth,
        topCohortRepeat,
      },
      currency: result.currency,
    }
  } catch (e) {
    console.error('[ai-calc/cohorts] Error computing cohorts:', e)
    return null
  }
}
