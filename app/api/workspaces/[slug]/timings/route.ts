import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'
import { computeTimings } from '@/lib/timings/compute'
import type { TimingsGroupBy, TimingsMetric } from '@/lib/timings/types'
import {
  isWoocommerceOrderIncluded,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import { ensureWooOrderTypesForOrderFilters } from '@/lib/integrations/woocommerce-sync'

const METRICS: TimingsMetric[] = ['median', 'mean']
const GROUP_BY_OPTIONS: TimingsGroupBy[] = [
  'product',
  'variant',
  'vendor',
  'productType',
]

function parseDate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
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
  const from = parseDate(searchParams.get('from'))
  const to = parseDate(searchParams.get('to'))
  const metric = searchParams.get('metric') as TimingsMetric | null
  const groupByParam = searchParams.get('groupBy') as TimingsGroupBy | null
  const groupId =
    searchParams.get('groupId') || searchParams.get('productId') || undefined

  if (!from || !to) {
    return NextResponse.json(
      { error: 'Missing or invalid from/to (YYYY-MM-DD)' },
      { status: 400 }
    )
  }
  const fromDate = new Date(from + 'T00:00:00.000Z')
  const toDate = new Date(to + 'T23:59:59.999Z')
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  const validMetric = metric && METRICS.includes(metric) ? metric : 'median'
  const validGroupBy =
    groupByParam && GROUP_BY_OPTIONS.includes(groupByParam)
      ? groupByParam
      : 'product'

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
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const guard = featureGuard(workspace.features as any, 'timings')
  if (guard) return guard

  const isWoocommerce = workspace.platform === 'WOOCOMMERCE'

  if (isWoocommerce) {
    const wooConn = await prisma.woocommerceConnection.findUnique({
      where: { workspaceId: workspace.id },
      select: { id: true, currency: true },
    })

    if (!wooConn) {
      return NextResponse.json(
        { error: 'No connected WooCommerce store' },
        { status: 404 }
      )
    }

    const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)
    await ensureWooOrderTypesForOrderFilters(wooConn.id, orderFilterSettings, { maxUpdates: 5000 })
    const allOrders = await prisma.woocommerceOrder.findMany({
      where: {
        connectionId: wooConn.id,
        status: { notIn: ['cancelled', 'failed', 'pending'] },
        customerEmail: { not: null },
        dateCreated: { not: null },
      },
      select: {
        customerEmail: true,
        dateCreated: true,
        total: true,
        orderType: true,
        rawJson: true,
      },
      orderBy: { dateCreated: 'asc' },
    })
    const orders = allOrders.filter((o) =>
      isWoocommerceOrderIncluded(
        { orderType: o.orderType, rawJson: o.rawJson, total: o.total },
        orderFilterSettings
      )
    )

    const ordersByCustomer = new Map<string, Date[]>()
    for (const order of orders) {
      const email = order.customerEmail
      const createdAt = order.dateCreated
      if (!email || !createdAt) continue
      const normalizedEmail = email.trim().toLowerCase()
      if (!normalizedEmail) continue
      if (!ordersByCustomer.has(normalizedEmail)) {
        ordersByCustomer.set(normalizedEmail, [])
      }
      ordersByCustomer.get(normalizedEmail)!.push(createdAt)
    }

    const gaps: { gap1: number[]; gap2: number[]; gap3: number[] } = {
      gap1: [],
      gap2: [],
      gap3: [],
    }

    let count2nd = 0
    let count3rd = 0
    let count4th = 0

    for (const dates of ordersByCustomer.values()) {
      if (dates.length < 2) continue
      const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
      const uniqueSorted = sorted.filter((d, idx) =>
        idx === 0 ? true : d.getTime() !== sorted[idx - 1]!.getTime()
      )
      if (uniqueSorted.length < 2) continue

      if (uniqueSorted.length >= 2) count2nd++
      if (uniqueSorted.length >= 3) count3rd++
      if (uniqueSorted.length >= 4) count4th++

      for (let i = 1; i < Math.min(uniqueSorted.length, 4); i++) {
        const days =
          (uniqueSorted[i]!.getTime() - uniqueSorted[i - 1]!.getTime()) /
          (1000 * 60 * 60 * 24)
        if (days < 0) continue
        if (i === 1) gaps.gap1.push(days)
        if (i === 2) gaps.gap2.push(days)
        if (i === 3) gaps.gap3.push(days)
      }
    }

    const pickMetric = (arr: number[]): number => {
      if (arr.length === 0) return 0
      const sorted = [...arr].sort((a, b) => a - b)
      if (validMetric === 'mean') {
        return sorted.reduce((sum, n) => sum + n, 0) / sorted.length
      }
      const mid = Math.floor(sorted.length / 2)
      if (sorted.length % 2 === 0) {
        return (sorted[mid - 1]! + sorted[mid]!) / 2
      }
      return sorted[mid]!
    }

    const firstOrders = ordersByCustomer.size
    const median1to2 = pickMetric(gaps.gap1)
    const median2to3 = pickMetric(gaps.gap2)
    const median3to4 = pickMetric(gaps.gap3)

    const cohortEmails = Array.from(ordersByCustomer.keys())
    const allFirstOrdersWithItems = await prisma.woocommerceOrder.findMany({
      where: {
        connectionId: wooConn.id,
        status: { notIn: ['cancelled', 'failed', 'pending'] },
        customerEmail: { in: cohortEmails },
        dateCreated: { not: null },
      },
      select: {
        customerEmail: true,
        dateCreated: true,
        total: true,
        orderType: true,
        rawJson: true,
        lineItems: {
          select: {
            productId: true,
            name: true,
            sku: true,
            total: true,
          },
        },
      },
      orderBy: { dateCreated: 'asc' },
    })
    const firstOrdersWithItems = allFirstOrdersWithItems.filter((o) =>
      isWoocommerceOrderIncluded(
        { orderType: o.orderType, rawJson: o.rawJson, total: o.total },
        orderFilterSettings
      )
    )

    const firstOrderByEmail = new Map<string, (typeof firstOrdersWithItems)[number]>()
    for (const order of firstOrdersWithItems) {
      const email = order.customerEmail?.trim().toLowerCase()
      if (!email || firstOrderByEmail.has(email)) continue
      firstOrderByEmail.set(email, order)
    }

    type ProductGroup = {
      id: string
      label: string
      customerEmails: string[]
    }
    const productGroups = new Map<string, ProductGroup>()

    for (const [email, firstOrder] of firstOrderByEmail.entries()) {
      const primaryItem = firstOrder.lineItems.reduce<
        (typeof firstOrder.lineItems)[number] | null
      >((best, lineItem) => {
        if (!best) return lineItem
        return Number(lineItem.total ?? 0) > Number(best.total ?? 0)
          ? lineItem
          : best
      }, null)

      if (!primaryItem) continue

      const key = String(primaryItem.productId ?? primaryItem.sku ?? 'unknown')
      if (!productGroups.has(key)) {
        productGroups.set(key, {
          id: key,
          label: primaryItem.name ?? primaryItem.sku ?? 'Unknown',
          customerEmails: [],
        })
      }
      productGroups.get(key)!.customerEmails.push(email)
    }

    const groups = Array.from(productGroups.values())
      .map((group) => {
        const gap1: number[] = []
        const gap2: number[] = []
        const gap3: number[] = []
        let groupCount2nd = 0
        let groupCount3rd = 0
        let groupCount4th = 0

        for (const email of group.customerEmails) {
          const dates = ordersByCustomer.get(email) ?? []
          const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
          const uniqueSorted = sorted.filter((d, idx) =>
            idx === 0 ? true : d.getTime() !== sorted[idx - 1]!.getTime()
          )

          if (uniqueSorted.length >= 2) groupCount2nd++
          if (uniqueSorted.length >= 3) groupCount3rd++
          if (uniqueSorted.length >= 4) groupCount4th++

          for (let i = 1; i < Math.min(uniqueSorted.length, 4); i++) {
            const days =
              (uniqueSorted[i]!.getTime() - uniqueSorted[i - 1]!.getTime()) /
              (1000 * 60 * 60 * 24)
            if (days < 0) continue
            if (i === 1) gap1.push(days)
            if (i === 2) gap2.push(days)
            if (i === 3) gap3.push(days)
          }
        }

        const firstOrdersCount = group.customerEmails.length
        const typical1to2 = pickMetric(gap1)

        return {
          id: group.id,
          label: group.label,
          groupBy: validGroupBy,
          firstOrders: firstOrdersCount,
          secondOrdersPct:
            firstOrdersCount > 0 ? (groupCount2nd / firstOrdersCount) * 100 : 0,
          thirdOrdersPct:
            firstOrdersCount > 0 ? (groupCount3rd / firstOrdersCount) * 100 : 0,
          fourthOrdersPct:
            firstOrdersCount > 0 ? (groupCount4th / firstOrdersCount) * 100 : 0,
          days1to2: gap1.length > 0 ? typical1to2 : null,
          days2to3: gap2.length > 0 ? pickMetric(gap2) : null,
          days3to4: gap3.length > 0 ? pickMetric(gap3) : null,
          reactivationDays: gap1.length > 0 ? 0.8 * typical1to2 : null,
        }
      })
      .filter((group) => (groupId ? group.id === groupId : true))
      .sort((a, b) => b.firstOrders - a.firstOrders)

    return NextResponse.json({
      summary: {
        firstOrders,
        secondOrdersPct: firstOrders > 0 ? (count2nd / firstOrders) * 100 : 0,
        thirdOrdersPct: firstOrders > 0 ? (count3rd / firstOrders) * 100 : 0,
        fourthOrdersPct: firstOrders > 0 ? (count4th / firstOrders) * 100 : 0,
        median1to2,
        median2to3,
        median3to4,
        reactivationDays: 0.8 * median1to2,
      },
      groups,
      currency: wooConn.currency ?? 'USD',
    })
  }

  const result = await computeTimings(prisma, workspace, {
    from,
    to,
    metric: validMetric,
    groupBy: validGroupBy,
    groupId,
  })

  return NextResponse.json(result)
}
