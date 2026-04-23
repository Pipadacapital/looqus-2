import { NextResponse, type NextRequest } from 'next/server'
import { format } from 'date-fns'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'
import { normalizeOrderFilterSettings } from '@/lib/order-filters'
import { computeCustomerLifecycleReport } from '@/lib/metrics/customer-lifecycle-report'
import {
  classifyCustomerLifecycle,
  emptyLifecycleCounts,
  netActiveCount,
  type LifecycleBucket,
} from '@/lib/metrics/customer-lifecycle'
import {
  FALLBACK_P40_DAYS,
  FALLBACK_P80_DAYS,
  MIN_GAPS_FOR_EMPIRICAL,
} from '@/lib/metrics/churn-thresholds'
import { differenceInCalendarDays } from 'date-fns'

function parseYyyyMmDd(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function percentileLinear(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  if (n === 1) return sortedAsc[0] ?? 0
  const pos = (p / 100) * (n - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sortedAsc[lo] ?? 0
  const w = pos - lo
  return (sortedAsc[lo] ?? 0) + w * ((sortedAsc[hi] ?? 0) - (sortedAsc[lo] ?? 0))
}

function medianSorted(sortedAsc: number[]): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  if (n % 2 === 1) return sortedAsc[mid] ?? 0
  return ((sortedAsc[mid - 1] ?? 0) + (sortedAsc[mid] ?? 0)) / 2
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const asOf =
    parseYyyyMmDd(searchParams.get('asOf')) ?? format(new Date(), 'yyyy-MM-dd')
  const trainingWindowDays = clamp(
    parseInt(searchParams.get('trainDays') ?? '365', 10) || 365,
    90,
    730
  )
  const revenueWindowDays = clamp(
    parseInt(searchParams.get('revenueDays') ?? '90', 10) || 90,
    7,
    365
  )

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  })
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const guard = featureGuard(workspace.features as any, 'customer_lifecycle')
  if (guard) return guard

  const isWoocommerce = workspace.platform === 'WOOCOMMERCE'
  if (isWoocommerce) {
    const wooConn = await prisma.woocommerceConnection.findUnique({
      where: { workspaceId: workspace.id },
      select: { id: true, currency: true },
    })
    if (!wooConn) {
      return NextResponse.json(
        { error: 'No connected WooCommerce store', code: 'NO_WOOCOMMERCE' },
        { status: 400 }
      )
    }

    const asOfEnd = new Date(asOf + 'T23:59:59.999Z')
    const trainFrom = new Date(asOfEnd)
    trainFrom.setUTCDate(trainFrom.getUTCDate() - trainingWindowDays)
    trainFrom.setUTCHours(0, 0, 0, 0)

    const revenueFrom = new Date(asOfEnd)
    revenueFrom.setUTCDate(revenueFrom.getUTCDate() - revenueWindowDays)
    revenueFrom.setUTCHours(0, 0, 0, 0)

    const trainOrders = await prisma.woocommerceOrder.findMany({
      where: {
        connectionId: wooConn.id,
        customerEmail: { not: null },
        dateCreated: { gte: trainFrom, lte: asOfEnd },
        status: { notIn: ['cancelled', 'failed', 'pending'] },
      },
      select: { customerEmail: true, dateCreated: true, wcOrderId: true },
      orderBy: [{ customerEmail: 'asc' }, { dateCreated: 'asc' }],
    })

    const gaps: number[] = []
    const trainByCustomer = new Map<string, Date[]>()
    for (const o of trainOrders) {
      if (!o.customerEmail || !o.dateCreated) continue
      const key = o.customerEmail.trim().toLowerCase()
      if (!key) continue
      const list = trainByCustomer.get(key) ?? []
      list.push(o.dateCreated)
      trainByCustomer.set(key, list)
    }

    let eligible = 0
    for (const list of trainByCustomer.values()) {
      if (list.length < 2) continue
      eligible++
      const sorted = [...list].sort((a, b) => a.getTime() - b.getTime())
      for (let i = 0; i < sorted.length - 1; i++) {
        const d = differenceInCalendarDays(sorted[i + 1]!, sorted[i]!)
        if (d >= 0) gaps.push(d)
      }
    }

    const sortedGaps = [...gaps].sort((a, b) => a - b)
    const usedFallback = sortedGaps.length < MIN_GAPS_FOR_EMPIRICAL
    const p40Days = usedFallback
      ? FALLBACK_P40_DAYS
      : Math.max(1, Math.round(percentileLinear(sortedGaps, 40)))
    const p80Days = usedFallback
      ? FALLBACK_P80_DAYS
      : Math.max(p40Days + 1, Math.round(percentileLinear(sortedGaps, 80)))

    const thresholds = {
      p40Days,
      p80Days,
      eligibleCustomerCount: eligible,
      repeatCustomerCount: eligible,
      totalGaps: sortedGaps.length,
      medianRepeatGapDays: sortedGaps.length
        ? Math.round(medianSorted(sortedGaps) * 10) / 10
        : 0,
      trainFrom: trainFrom.toISOString().slice(0, 10),
      trainTo: asOfEnd.toISOString().slice(0, 10),
      usedFallback,
    }

    const lifetimeOrders = await prisma.woocommerceOrder.findMany({
      where: {
        connectionId: wooConn.id,
        customerEmail: { not: null },
        dateCreated: { lte: asOfEnd },
        status: { notIn: ['cancelled', 'failed', 'pending'] },
      },
      select: { customerEmail: true, dateCreated: true },
      orderBy: [{ customerEmail: 'asc' }, { dateCreated: 'asc' }],
    })

    const lifecycleByCustomer = new Map<string, LifecycleBucket>()
    const counts = emptyLifecycleCounts()
    const byCustomer = new Map<string, { count: number; lastOrderAt: Date }>()
    for (const o of lifetimeOrders) {
      if (!o.customerEmail || !o.dateCreated) continue
      const key = o.customerEmail.trim().toLowerCase()
      if (!key) continue
      const existing = byCustomer.get(key)
      if (!existing) {
        byCustomer.set(key, { count: 1, lastOrderAt: o.dateCreated })
      } else {
        existing.count += 1
        if (o.dateCreated > existing.lastOrderAt) existing.lastOrderAt = o.dateCreated
      }
    }

    for (const [cid, meta] of byCustomer) {
      const bucket = classifyCustomerLifecycle({
        orderCount: meta.count,
        lastOrderAt: meta.lastOrderAt,
        asOfDate: asOfEnd,
        p40Days,
        p80Days,
      })
      lifecycleByCustomer.set(cid, bucket)
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

    const revenueOrders = await prisma.woocommerceOrder.findMany({
      where: {
        connectionId: wooConn.id,
        dateCreated: { gte: revenueFrom, lte: asOfEnd },
        status: { notIn: ['cancelled', 'failed', 'pending'] },
      },
      select: { customerEmail: true, total: true },
    })

    let unattributedRevenue = 0
    let unattributedOrderCount = 0
    for (const o of revenueOrders) {
      const amount = Number(o.total ?? 0)
      const key = o.customerEmail?.trim().toLowerCase() ?? ''
      if (!key) {
        unattributedRevenue += amount
        unattributedOrderCount += 1
        continue
      }
      const bucket = lifecycleByCustomer.get(key)
      if (!bucket) {
        unattributedRevenue += amount
        unattributedOrderCount += 1
        continue
      }
      revenueByBucket[bucket] += amount
      orderCountByBucket[bucket] += 1
    }

    const anyOrderCurrency = await prisma.woocommerceOrder.findFirst({
      where: { connectionId: wooConn.id, currency: { not: null } },
      select: { currency: true },
      orderBy: { dateCreated: 'desc' },
    })
    const currency =
      wooConn.currency?.trim() || anyOrderCurrency?.currency?.trim() || null

    return NextResponse.json({
      asOf,
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
    })
  }

  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return NextResponse.json(
      { error: 'No connected Shopify store', code: 'NO_SHOPIFY' },
      { status: 400 }
    )
  }

  const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)

  const report = await computeCustomerLifecycleReport(prisma, connectionId, orderFilterSettings, {
    asOfYyyyMmDd: asOf,
    trainingWindowDays,
    revenueWindowDays,
  })

  return NextResponse.json(report)
}
