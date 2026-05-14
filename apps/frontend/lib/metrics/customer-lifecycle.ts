/**
 * Customer lifecycle buckets from last order recency vs churn thresholds.
 *
 * Thresholds (`p40Days`, `p80Days`) come from `computeChurnThresholds` (repeat-gap percentiles).
 *
 * ## Bucket rules (as-of `asOfDate`, end-of-day UTC comparison via calendar days)
 * Let `d = differenceInCalendarDays(asOfDate, lastOrderAt)` = whole calendar days since last included order.
 *
 * **Multi-order customers** (orderCount ≥ 2):
 * - **active**: d ≤ p40 — still within "typical" short repeat window.
 * - **at_risk**: p40 < d ≤ p80 — longer than typical short cycle, not yet extreme tail.
 * - **churned**: d > p80.
 *
 * **Single-order customers** (orderCount === 1):
 * - **new**: d ≤ p40 — recent first/only purchase (still in short window).
 * - **at_risk**: p40 < d ≤ p80 — one-time buyer cooling.
 * - **churned**: d > p80 — no second order within long tail window.
 *
 * **reactivated**: Not assigned in this slice (would need pre-churn history + return purchase).
 *
 * Customers with no orders are not classified here (caller should exclude).
 */

import { differenceInCalendarDays } from 'date-fns'

export type LifecycleBucket = 'new' | 'active' | 'at_risk' | 'churned'

export type LifecycleClassifyInput = {
  orderCount: number
  lastOrderAt: Date
  asOfDate: Date
  p40Days: number
  p80Days: number
}

export function classifyCustomerLifecycle(input: LifecycleClassifyInput): LifecycleBucket {
  const { orderCount, lastOrderAt, asOfDate, p40Days, p80Days } = input
  if (orderCount < 1) {
    throw new Error('classifyCustomerLifecycle: orderCount must be >= 1')
  }
  const d = Math.max(0, differenceInCalendarDays(asOfDate, lastOrderAt))

  if (orderCount === 1) {
    if (d <= p40Days) return 'new'
    if (d <= p80Days) return 'at_risk'
    return 'churned'
  }

  if (d <= p40Days) return 'active'
  if (d <= p80Days) return 'at_risk'
  return 'churned'
}

const BUCKETS: LifecycleBucket[] = ['new', 'active', 'at_risk', 'churned']

export function emptyLifecycleCounts(): Record<LifecycleBucket, number> {
  return { new: 0, active: 0, at_risk: 0, churned: 0 }
}

export function addToLifecycleCounts(
  acc: Record<LifecycleBucket, number>,
  bucket: LifecycleBucket
): void {
  acc[bucket]++
}

/** Net active = customers still in short window (new + active). */
export function netActiveCount(counts: Record<LifecycleBucket, number>): number {
  return counts.new + counts.active
}

export { BUCKETS as LIFECYCLE_BUCKETS }
