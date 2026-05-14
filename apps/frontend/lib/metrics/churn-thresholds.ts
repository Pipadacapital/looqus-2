/**
 * Workspace churn thresholds from empirical repeat-order gaps.
 *
 * ## Definitions
 * - **Included order**: Same as analytics — `getOrderInclusionWhere(settings)` (tags, zero-sales).
 * - **Repeat gap**: For one customer, consecutive included orders sorted by `processedAt` (then `id` tie-break).
 *   `gapDays = differenceInCalendarDays(order[i+1].processedAt, order[i].processedAt)`.
 *   Only pairs where **both** orders fall in `[trainFrom, trainTo]` (inclusive) enter the sample.
 * - **Eligible (repeat) customers**: Customers with at least two included orders in that same window
 *   (they contribute ≥1 gap).
 *
 * ## Percentiles (deterministic)
 * Sort all sample gaps ascending: `g[0] <= ... <= g[n-1]`.
 * **pK** = linear interpolation on rank index: `pos = (K/100) * (n-1)`, blend `g[floor(pos)]` and `g[ceil(pos)]`.
 * Same method as common spreadsheet PERCENTILE.INC.
 *
 * ## Fallback
 * If `totalGaps < MIN_GAPS_FOR_EMPIRICAL`, use fixed defaults and set `usedFallback: true`:
 *   p40 = 45 calendar days, p80 = 120 calendar days (documented heuristics for DTC).
 */

import { differenceInCalendarDays } from 'date-fns'
import type { PrismaClient } from '@prisma/client'
import {
  getOrderInclusionWhere,
  type OrderFilterSettings,
} from '@/lib/order-filters'

/** Minimum distinct inter-order gaps before trusting empirical percentiles. */
export const MIN_GAPS_FOR_EMPIRICAL = 20

export const FALLBACK_P40_DAYS = 45
export const FALLBACK_P80_DAYS = 120

export type ChurnThresholdsResult = {
  /** 40th percentile of repeat gaps (days); "typical short cycle" bound. */
  p40Days: number
  /** 80th percentile of repeat gaps (days); "long tail / likely churn" bound. */
  p80Days: number
  /** Customers with ≥2 included orders in the training window (each contributes gaps). */
  eligibleCustomerCount: number
  /** Same as eligibleCustomerCount (repeat customers in window). */
  repeatCustomerCount: number
  /** Number of gap observations in the sample. */
  totalGaps: number
  /** Median of sample gaps (days); 0 if no gaps. */
  medianRepeatGapDays: number
  trainFrom: string
  trainTo: string
  usedFallback: boolean
}

function percentileLinear(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  if (n === 1) return sortedAsc[0]!
  const pos = (p / 100) * (n - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sortedAsc[lo]!
  const w = pos - lo
  return sortedAsc[lo]! + w * (sortedAsc[hi]! - sortedAsc[lo]!)
}

function medianSorted(sortedAsc: number[]): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  if (n % 2 === 1) return sortedAsc[mid]!
  return (sortedAsc[mid - 1]! + sortedAsc[mid]!) / 2
}

/**
 * Build repeat-gap sample from included orders in `[trainFrom, trainTo]` only.
 */
export async function computeChurnThresholds(
  prisma: PrismaClient,
  connectionId: string,
  trainFrom: Date,
  trainTo: Date,
  orderFilterSettings: OrderFilterSettings
): Promise<ChurnThresholdsResult> {
  const inclusionWhere = getOrderInclusionWhere(orderFilterSettings)
  const orders = await prisma.shopifyOrder.findMany({
    where: {
      connectionId,
      customerShopifyId: { not: null, notIn: [''] },
      processedAt: { gte: trainFrom, lte: trainTo },
      ...inclusionWhere,
    },
    select: {
      id: true,
      customerShopifyId: true,
      processedAt: true,
    },
    orderBy: [{ customerShopifyId: 'asc' }, { processedAt: 'asc' }, { id: 'asc' }],
  })

  const byCustomer = new Map<string, { processedAt: Date; id: string }[]>()
  for (const o of orders) {
    const cid = o.customerShopifyId
    if (!cid) continue
    let list = byCustomer.get(cid)
    if (!list) {
      list = []
      byCustomer.set(cid, list)
    }
    list.push({ processedAt: o.processedAt, id: o.id })
  }

  const gaps: number[] = []
  let eligible = 0
  for (const [, list] of byCustomer) {
    if (list.length < 2) continue
    eligible++
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i]!.processedAt
      const b = list[i + 1]!.processedAt
      const d = differenceInCalendarDays(b, a)
      if (d >= 0) gaps.push(d)
    }
  }

  const sorted = [...gaps].sort((x, y) => x - y)
  const usedFallback = sorted.length < MIN_GAPS_FOR_EMPIRICAL
  const p40Days = usedFallback
    ? FALLBACK_P40_DAYS
    : Math.max(1, Math.round(percentileLinear(sorted, 40)))
  const p80Days = usedFallback
    ? FALLBACK_P80_DAYS
    : Math.max(p40Days + 1, Math.round(percentileLinear(sorted, 80)))

  const trainFromIso = trainFrom.toISOString().slice(0, 10)
  const trainToIso = trainTo.toISOString().slice(0, 10)

  return {
    p40Days,
    p80Days,
    eligibleCustomerCount: eligible,
    repeatCustomerCount: eligible,
    totalGaps: sorted.length,
    medianRepeatGapDays: sorted.length ? Math.round(medianSorted(sorted) * 10) / 10 : 0,
    trainFrom: trainFromIso,
    trainTo: trainToIso,
    usedFallback,
  }
}
