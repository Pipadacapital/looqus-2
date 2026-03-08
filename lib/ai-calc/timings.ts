/**
 * Timings calculator for AI context.
 * Wraps lib/timings/compute.ts to get summary repurchase intervals.
 */
import type { PrismaClient } from '@prisma/client'
import type { AiTimingsData } from './types'
import { computeTimings } from '@/lib/timings/compute'

interface TimingsWorkspace {
  id: string
  shopifyConnections: { id: string }[]
}

export async function calcTimings(
  prisma: PrismaClient,
  workspace: TimingsWorkspace,
  fromStr: string,
  toStr: string,
): Promise<AiTimingsData | null> {
  try {
    const result = await computeTimings(prisma, workspace, {
      from: fromStr,
      to: toStr,
      metric: 'median',
    })

    return {
      summary: {
        firstOrders: result.summary.firstOrders,
        secondOrdersPct: result.summary.secondOrdersPct,
        thirdOrdersPct: result.summary.thirdOrdersPct,
        fourthOrdersPct: result.summary.fourthOrdersPct,
        median1to2: result.summary.median1to2,
        median2to3: result.summary.median2to3,
        median3to4: result.summary.median3to4,
        reactivationDays: result.summary.reactivationDays,
      },
    }
  } catch (e) {
    console.error('[ai-calc/timings] Error computing timings:', e)
    return null
  }
}
