/**
 * Aggregates lifecycle counts and trailing-window revenue by bucket.
 * Uses workspace order inclusion + `computeChurnThresholds` + `classifyCustomerLifecycle`.
 *
 * **Revenue attribution**: Each included order in `[revenueFrom, asOfEnd]` is summed into the bucket
 * of its `customerShopifyId` as classified at `asOfEnd` (lifetime order count + last order date).
 * Orders with missing/empty customer id are **unattributed** (reported separately).
 */

import type { PrismaClient } from '@prisma/client'
import type { OrderFilterSettings } from '@/lib/order-filters'
import { getOrderInclusionWhere } from '@/lib/order-filters'
import { computeChurnThresholds, type ChurnThresholdsResult } from './churn-thresholds'
import {
  classifyCustomerLifecycle,
  emptyLifecycleCounts,
  netActiveCount,
  type LifecycleBucket,
} from './customer-lifecycle'

export type CustomerLifecycleReportPayload = {
  asOf: string
  /** Training window length (days) used for threshold gaps. */
  trainingWindowDays: number
  /** Trailing days for revenue / order counts by bucket. */
  revenueWindowDays: number
  thresholds: ChurnThresholdsResult
  counts: Record<LifecycleBucket, number>
  /** new + active */
  netActive: number
  /** Sum of order totalPrice in revenue window, by customer lifecycle bucket. */
  revenueByBucket: Record<LifecycleBucket, number>
  orderCountByBucket: Record<LifecycleBucket, number>
  unattributedRevenue: number
  unattributedOrderCount: number
  currency: string | null
}

function parseAsOfEndUtc(asOfYyyyMmDd: string): Date {
  const d = new Date(asOfYyyyMmDd + 'T23:59:59.999Z')
  if (Number.isNaN(d.getTime())) throw new Error('Invalid asOf date')
  return d
}

function trainWindowBounds(asOfEnd: Date, trainingWindowDays: number): { trainFrom: Date; trainTo: Date } {
  const trainTo = asOfEnd
  const trainFrom = new Date(asOfEnd)
  trainFrom.setUTCDate(trainFrom.getUTCDate() - trainingWindowDays)
  trainFrom.setUTCHours(0, 0, 0, 0)
  return { trainFrom, trainTo }
}

function revenueWindowBounds(asOfEnd: Date, revenueWindowDays: number): { revenueFrom: Date } {
  const revenueFrom = new Date(asOfEnd)
  revenueFrom.setUTCDate(revenueFrom.getUTCDate() - revenueWindowDays)
  revenueFrom.setUTCHours(0, 0, 0, 0)
  return { revenueFrom }
}

export async function computeCustomerLifecycleReport(
  prisma: PrismaClient,
  connectionId: string,
  orderFilterSettings: OrderFilterSettings,
  options: {
    asOfYyyyMmDd: string
    trainingWindowDays: number
    revenueWindowDays: number
  }
): Promise<CustomerLifecycleReportPayload> {
  const { asOfYyyyMmDd, trainingWindowDays, revenueWindowDays } = options
  const asOfEnd = parseAsOfEndUtc(asOfYyyyMmDd)
  const { trainFrom, trainTo } = trainWindowBounds(asOfEnd, trainingWindowDays)
  const { revenueFrom } = revenueWindowBounds(asOfEnd, revenueWindowDays)

  const inclusionWhere = getOrderInclusionWhere(orderFilterSettings)

  const thresholds = await computeChurnThresholds(
    prisma,
    connectionId,
    trainFrom,
    trainTo,
    orderFilterSettings
  )

  const groups = await prisma.shopifyOrder.groupBy({
    by: ['customerShopifyId'],
    where: {
      connectionId,
      customerShopifyId: { not: null, notIn: [''] },
      ...inclusionWhere,
    },
    _max: { processedAt: true },
    _count: { _all: true },
  })

  const customerBucket = new Map<string, LifecycleBucket>()
  const counts = emptyLifecycleCounts()

  for (const g of groups) {
    const cid = g.customerShopifyId
    if (!cid) continue
    const last = g._max.processedAt
    if (!last) continue
    const n = g._count._all
    const bucket = classifyCustomerLifecycle({
      orderCount: n,
      lastOrderAt: last,
      asOfDate: asOfEnd,
      p40Days: thresholds.p40Days,
      p80Days: thresholds.p80Days,
    })
    customerBucket.set(cid, bucket)
    counts[bucket]++
  }

  const revenueByBucket: Record<LifecycleBucket, number> = {
    new: 0,
    active: 0,
    at_risk: 0,
    churned: 0,
  }
  const orderCountByBucket: Record<LifecycleBucket, number> = {
    new: 0,
    active: 0,
    at_risk: 0,
    churned: 0,
  }

  const revenueGroups = await prisma.shopifyOrder.groupBy({
    by: ['customerShopifyId'],
    where: {
      connectionId,
      processedAt: { gte: revenueFrom, lte: asOfEnd },
      ...inclusionWhere,
    },
    _sum: { totalPrice: true },
    _count: { _all: true },
  })

  let unattributedRevenue = 0
  let unattributedOrderCount = 0

  for (const rg of revenueGroups) {
    const amount = Number(rg._sum.totalPrice ?? 0)
    const n = rg._count._all
    const cid = rg.customerShopifyId
    if (!cid || cid === '') {
      unattributedRevenue += amount
      unattributedOrderCount += n
      continue
    }
    const bucket = customerBucket.get(cid)
    if (!bucket) {
      unattributedRevenue += amount
      unattributedOrderCount += n
      continue
    }
    revenueByBucket[bucket] += amount
    orderCountByBucket[bucket] += n
  }

  const currencyRow = await prisma.shopifyOrder.findFirst({
    where: {
      connectionId,
      processedAt: { gte: revenueFrom, lte: asOfEnd },
      ...inclusionWhere,
    },
    select: { currency: true },
  })
  const currency = currencyRow?.currency ?? null

  return {
    asOf: asOfYyyyMmDd,
    trainingWindowDays,
    revenueWindowDays,
    thresholds,
    counts,
    netActive: netActiveCount(counts),
    revenueByBucket,
    orderCountByBucket,
    unattributedRevenue,
    unattributedOrderCount,
    currency,
  }
}
