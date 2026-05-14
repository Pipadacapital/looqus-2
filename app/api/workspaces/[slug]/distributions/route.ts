import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'
import { computeDistributions } from '@/lib/distributions/compute'
import type { DistributionsMetric, DistributionsSortColumn } from '@/lib/distributions/compute'
import {
  isWoocommerceOrderIncluded,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import { ensureWooOrderTypesForOrderFilters } from '@/lib/integrations/woocommerce-sync'

function parseDate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

const SORT_COLUMNS: DistributionsSortColumn[] = ['product', 'orders', 'mode', 'mean', 'diff']

function computeMode(values: number[]): number {
  if (values.length === 0) return 0
  const rounded = values.map((v) => Math.round(v * 100) / 100)
  const freq = new Map<number, number>()
  for (const r of rounded) freq.set(r, (freq.get(r) ?? 0) + 1)
  let bestValue = rounded[0] ?? 0
  let bestCount = 0
  for (const [val, count] of freq) {
    if (count > bestCount || (count === bestCount && val < bestValue)) {
      bestValue = val
      bestCount = count
    }
  }
  return bestValue
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function buildGraphPoints(values: number[], numBuckets: number = 60) {
  if (values.length === 0) {
    return { points: [], globalMode: 0, globalMean: 0 }
  }
  const globalMean = mean(values)
  const globalMode = computeMode(values)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const bucketWidth = range / numBuckets
  const counts = new Array(numBuckets).fill(0)
  for (const v of values) {
    const idx = Math.min(
      numBuckets - 1,
      Math.max(0, Math.floor((v - min) / bucketWidth))
    )
    counts[idx]++
  }
  const total = values.length
  const points = counts.map((count, i) => ({
    value: min + (i + 0.5) * bucketWidth,
    density: total > 0 ? count / total : 0,
  }))
  return { points, globalMode, globalMean }
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
  const metric = (searchParams.get('metric') ?? 'cm1') as DistributionsMetric
  const sort = (searchParams.get('sort') ?? 'orders') as DistributionsSortColumn
  const dir = (searchParams.get('dir') ?? 'desc') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? '20', 10) || 20))
  const search = searchParams.get('search') ?? undefined

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

  const validMetric: DistributionsMetric = metric === 'sales' ? 'sales' : 'cm1'
  const validSort = SORT_COLUMNS.includes(sort) ? sort : 'orders'

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

  const guard = featureGuard(workspace.features as any, 'distributions')
  if (guard) return guard

  const isWoocommerce = workspace.platform === 'WOOCOMMERCE'

  try {
    if (isWoocommerce) {
      const wooConn = await prisma.woocommerceConnection.findUnique({
        where: { workspaceId: workspace.id },
        select: { id: true, currency: true },
      })

      if (!wooConn) {
        return NextResponse.json({
          rows: [],
          totalRows: 0,
          currency: 'USD',
          distributionValues: [],
          globalMode: 0,
          globalMean: 0,
          graphPoints: [],
        })
      }

      const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)
      await ensureWooOrderTypesForOrderFilters(wooConn.id, orderFilterSettings, { maxUpdates: 5000 })
      const orders = await prisma.woocommerceOrder.findMany({
        where: {
          connectionId: wooConn.id,
          status: { notIn: ['cancelled', 'failed', 'pending'] },
          dateCreated: { gte: fromDate, lte: toDate },
        },
        select: {
          id: true,
          currency: true,
          total: true,
          orderType: true,
          rawJson: true,
          lineItems: {
            select: {
              productId: true,
              name: true,
              sku: true,
              quantity: true,
              price: true,
              subtotal: true,
              total: true,
            },
          },
        },
      })
      const includedOrders = orders.filter((o) =>
        isWoocommerceOrderIncluded(
          { orderType: o.orderType, rawJson: o.rawJson, total: o.total },
          orderFilterSettings
        )
      )
      const anyOrderWithCurrency = await prisma.woocommerceOrder.findFirst({
        where: {
          connectionId: wooConn.id,
          currency: { not: null },
        },
        select: { currency: true },
        orderBy: { dateCreated: 'desc' },
      })
      const storeCurrency =
        wooConn.currency?.trim() ||
        orders.find((o) => (o.currency?.trim()?.length ?? 0) > 0)?.currency?.trim() ||
        anyOrderWithCurrency?.currency?.trim() ||
        'USD'

      const cogsSettings = await prisma.woocommerceProduct.findMany({
        where: {
          connectionId: wooConn.id,
          sku: { not: null },
          coq: { not: null },
          status: { not: 'trash' },
        },
        select: { sku: true, coq: true },
      })
      const cogsMap = new Map(
        cogsSettings.map((c) => [c.sku?.trim().toLowerCase(), Number(c.coq ?? 0)])
      )

      type ProductAcc = { label: string; perOrderSales: number[]; perOrderCM1: number[] }
      const byProduct = new Map<string, ProductAcc>()

      for (const order of includedOrders) {
        const perOrderProduct = new Map<string, { label: string; sales: number; cogs: number }>()

        for (const li of order.lineItems) {
          const qty = li.quantity ?? 0
          const lineSales =
            Number(li.total ?? 0) ||
            Number(li.subtotal ?? 0) ||
            Number(li.price ?? 0) * qty
          if (lineSales === 0 && qty === 0) continue

          const productKey = String(li.productId ?? li.sku ?? li.name ?? '__unknown__')
          const label = li.name?.trim() || li.sku?.trim() || 'Unknown'
          const skuKey = li.sku?.trim().toLowerCase()
          const cogsPerUnit = skuKey ? (cogsMap.get(skuKey) ?? 0) : 0
          const lineCogs = cogsPerUnit * qty

          const existing = perOrderProduct.get(productKey) ?? { label, sales: 0, cogs: 0 }
          perOrderProduct.set(productKey, {
            label: existing.label,
            sales: existing.sales + lineSales,
            cogs: existing.cogs + lineCogs,
          })
        }

        for (const [productKey, val] of perOrderProduct) {
          const acc = byProduct.get(productKey) ?? {
            label: val.label,
            perOrderSales: [],
            perOrderCM1: [],
          }
          acc.perOrderSales.push(val.sales)
          acc.perOrderCM1.push(val.sales - val.cogs)
          byProduct.set(productKey, acc)
        }
      }

      const allPerOrderSales: number[] = []
      const allPerOrderCM1: number[] = []
      for (const acc of byProduct.values()) {
        allPerOrderSales.push(...acc.perOrderSales)
        allPerOrderCM1.push(...acc.perOrderCM1)
      }

      const distributionValues =
        validMetric === 'sales' ? allPerOrderSales : allPerOrderCM1
      const { points: graphPoints, globalMode, globalMean } =
        buildGraphPoints(distributionValues)

      const rows = Array.from(byProduct.values()).map((acc) => {
        const metricValues =
          validMetric === 'sales' ? acc.perOrderSales : acc.perOrderCM1
        const modeVal = computeMode(metricValues)
        const meanVal = mean(metricValues)
        return {
          product: acc.label,
          orders: acc.perOrderSales.length,
          mode: modeVal,
          mean: meanVal,
          diff: modeVal - meanVal,
        }
      })

      let filtered = rows
      if (search?.trim()) {
        const q = search.trim().toLowerCase()
        filtered = rows.filter((r) => r.product.toLowerCase().includes(q))
      }

      const totalRows = filtered.length
      filtered.sort((a, b) => {
        let diff = 0
        switch (validSort) {
          case 'product':
            diff = a.product.localeCompare(b.product)
            break
          case 'orders':
            diff = a.orders - b.orders
            break
          case 'mode':
            diff = a.mode - b.mode
            break
          case 'mean':
            diff = a.mean - b.mean
            break
          case 'diff':
            diff = a.diff - b.diff
            break
          default:
            diff = a.orders - b.orders
        }
        return dir === 'asc' ? diff : -diff
      })

      const start = (page - 1) * pageSize
      const paginated = filtered.slice(start, start + pageSize)

      return NextResponse.json({
        rows: paginated,
        totalRows,
        currency: storeCurrency,
        distributionValues,
        globalMode,
        globalMean,
        graphPoints,
      })
    }

    const result = await computeDistributions(prisma, workspace as Parameters<typeof computeDistributions>[1], {
      from,
      to,
      metric: validMetric,
      search,
      sort: validSort,
      dir,
      page,
      pageSize,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[Distributions] computeDistributions failed', { slug, workspaceId: workspace.id, message, stack })
    return NextResponse.json(
      { error: 'Distributions computation failed', details: process.env.NODE_ENV === 'development' ? message : undefined },
      { status: 500 }
    )
  }
}
