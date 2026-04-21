/**
 * First product cascade for WooCommerce — same response shape as `computeFirstProductCascade`.
 *
 * Cohort: customers (normalized email) whose **first order in [from, to]** is in that window
 * (chronologically first included order with a known email in the range).
 * Primary line on that order: highest `line.total`, then `productId`, then line id.
 * Repeat / LTV: all included orders for that email from first cohort order time through observation end.
 */

import { differenceInCalendarDays } from 'date-fns'
import type { PrismaClient } from '@prisma/client'
import type { FirstProductCascadeResult, FirstProductCascadeRow } from '@/lib/metrics/first-product-cascade'
import { EMPTY_FIRST_ORDER_KEY, NO_PRODUCT_KEY } from '@/lib/metrics/first-product-cascade'

const NULL_PID = '\uFFFF'

function endOfUtcDay(d: Date): Date {
  const x = new Date(d)
  x.setUTCHours(23, 59, 59, 999)
  return x
}

function addUtcDays(d: Date, days: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + days)
  return x
}

function normEmail(e: string | null | undefined): string | null {
  if (e == null) return null
  const t = e.trim().toLowerCase()
  return t.length > 0 ? t : null
}

type WooLinePick = {
  id: string
  productId: number | null
  price: { toString(): string }
  quantity: number
  total: { toString(): string } | null
  name: string | null
  sku: string | null
}

function lineRevenueWoo(li: WooLinePick): number {
  const t = Number(li.total ?? 0)
  if (Number.isFinite(t) && t !== 0) return Math.abs(t)
  return Number(li.price) * li.quantity
}

/** Primary line: max line total (abs), then productId, then id — mirrors Shopify tie order with `total` as primary. */
function pickPrimaryWooLine(lines: WooLinePick[]): WooLinePick | null {
  if (lines.length === 0) return null
  return [...lines].sort((a, b) => {
    const ra = lineRevenueWoo(a)
    const rb = lineRevenueWoo(b)
    if (rb !== ra) return rb - ra
    const pa = a.productId != null ? String(a.productId) : NULL_PID
    const pb = b.productId != null ? String(b.productId) : NULL_PID
    const c = pa.localeCompare(pb)
    if (c !== 0) return c
    return a.id.localeCompare(b.id)
  })[0]!
}

export async function computeFirstProductCascadeWoo(
  prisma: PrismaClient,
  wooConnectionId: string,
  params: {
    fromYyyyMmDd: string
    toYyyyMmDd: string
    observationDaysAfterTo?: number
    storeCurrency: string | null
  }
): Promise<FirstProductCascadeResult> {
  const observationDays = params.observationDaysAfterTo ?? 365
  const fromDate = new Date(params.fromYyyyMmDd + 'T00:00:00.000Z')
  const toDate = endOfUtcDay(new Date(params.toYyyyMmDd + 'T00:00:00.000Z'))
  const observationEnd = endOfUtcDay(addUtcDays(toDate, observationDays))

  const ordersInRange = await prisma.woocommerceOrder.findMany({
    where: {
      connectionId: wooConnectionId,
      dateCreated: { gte: fromDate, lte: toDate },
      status: { notIn: ['cancelled', 'failed', 'pending'] },
      customerEmail: { not: null },
    },
    include: { lineItems: true },
    orderBy: [{ dateCreated: 'asc' }, { id: 'asc' }],
  })

  const firstOrderByNormEmail = new Map<
    string,
    (typeof ordersInRange)[number] & { lineItems: typeof ordersInRange[0]['lineItems'] }
  >()
  for (const order of ordersInRange) {
    const ne = normEmail(order.customerEmail)
    if (!ne) continue
    if (!firstOrderByNormEmail.has(ne)) {
      firstOrderByNormEmail.set(ne, order)
    }
  }

  if (firstOrderByNormEmail.size === 0) {
    return {
      from: params.fromYyyyMmDd,
      to: params.toYyyyMmDd,
      observationDaysAfterTo: observationDays,
      observationEnd: observationEnd.toISOString().slice(0, 10),
      currency: params.storeCurrency,
      rows: [],
      totalCohortCustomers: 0,
    }
  }

  const cohortNormEmails = [...firstOrderByNormEmail.keys()]
  const cohortSet = new Set(cohortNormEmails)
  const firstAtByNormEmail = new Map<string, Date>()
  for (const [ne, o] of firstOrderByNormEmail) {
    if (o.dateCreated) firstAtByNormEmail.set(ne, o.dateCreated)
  }

  const allOrdersFlat = await prisma.woocommerceOrder.findMany({
    where: {
      connectionId: wooConnectionId,
      dateCreated: { lte: observationEnd },
      status: { notIn: ['cancelled', 'failed', 'pending'] },
      customerEmail: { not: null },
    },
    select: {
      id: true,
      customerEmail: true,
      dateCreated: true,
      total: true,
    },
    orderBy: [{ dateCreated: 'asc' }, { id: 'asc' }],
  })

  const byNormEmail = new Map<string, { id: string; dateCreated: Date; total: { toString(): string } }[]>()
  for (const o of allOrdersFlat) {
    const ne = normEmail(o.customerEmail)
    if (!ne || !cohortSet.has(ne)) continue
    const firstAt = firstAtByNormEmail.get(ne)!
    if (!o.dateCreated || o.dateCreated < firstAt) continue
    const list = byNormEmail.get(ne) ?? []
    list.push({
      id: o.id,
      dateCreated: o.dateCreated,
      total: o.total ?? { toString: () => '0' },
    })
    byNormEmail.set(ne, list)
  }

  const linesByFirstOrderId = new Map<string, WooLinePick[]>()
  for (const o of firstOrderByNormEmail.values()) {
    const lis: WooLinePick[] = (o.lineItems ?? []).map((li) => ({
      id: li.id,
      productId: li.productId ?? null,
      price: li.price ?? { toString: () => '0' },
      quantity: li.quantity ?? 0,
      total: li.total,
      name: li.name,
      sku: li.sku,
    }))
    linesByFirstOrderId.set(o.id, lis)
  }

  const productIds = [
    ...new Set(
      [...firstOrderByNormEmail.values()].flatMap((o) =>
        (o.lineItems ?? []).map((li) => li.productId).filter((x): x is number => x != null)
      )
    ),
  ]
  const wcProducts =
    productIds.length === 0
      ? []
      : await prisma.woocommerceProduct.findMany({
          where: { connectionId: wooConnectionId, wcProductId: { in: productIds } },
          select: { wcProductId: true, name: true },
        })
  const titleByProductId = new Map(
    wcProducts.map((p) => [p.wcProductId, p.name ?? `Product ${p.wcProductId}`])
  )

  const cohortByNormEmail = new Map<string, { productKey: string; productTitle: string }>()
  for (const [ne, fo] of firstOrderByNormEmail) {
    const lines = linesByFirstOrderId.get(fo.id) ?? []
    const primary = pickPrimaryWooLine(lines)
    if (!primary) {
      cohortByNormEmail.set(ne, {
        productKey: EMPTY_FIRST_ORDER_KEY,
        productTitle: 'Empty first order',
      })
      continue
    }
    const key = primary.productId != null ? String(primary.productId) : NO_PRODUCT_KEY
    const title =
      (primary.productId != null && titleByProductId.get(primary.productId)) ||
      primary.name ||
      primary.sku ||
      key
    cohortByNormEmail.set(ne, { productKey: key, productTitle: title })
  }

  type RowAgg = {
    productKey: string
    productTitle: string
    n: number
    c2: number
    c3: number
    c4p: number
    sumAdditionalOrders: number
    sumLtv: number
    daysToSecond: number[]
  }

  const rowAggs = new Map<string, RowAgg>()

  for (const ne of cohortNormEmails) {
    const cohort = cohortByNormEmail.get(ne)
    if (!cohort) continue

    const list = byNormEmail.get(ne) ?? []
    const sorted = [...list].sort((a, b) => {
      const t = a.dateCreated.getTime() - b.dateCreated.getTime()
      if (t !== 0) return t
      return a.id.localeCompare(b.id)
    })

    const nOrders = sorted.length
    const c2 = nOrders >= 2 ? 1 : 0
    const c3 = nOrders >= 3 ? 1 : 0
    const c4p = nOrders >= 4 ? 1 : 0
    const additional = Math.max(0, nOrders - 1)
    const ltv = sorted.reduce((s, o) => s + Number(o.total), 0)

    let d2: number | null = null
    if (nOrders >= 2) {
      const first = sorted[0]!
      const second = sorted[1]!
      d2 = differenceInCalendarDays(second.dateCreated, first.dateCreated)
    }

    const key = cohort.productKey
    let ra = rowAggs.get(key)
    if (!ra) {
      ra = {
        productKey: key,
        productTitle: cohort.productTitle,
        n: 0,
        c2: 0,
        c3: 0,
        c4p: 0,
        sumAdditionalOrders: 0,
        sumLtv: 0,
        daysToSecond: [],
      }
      rowAggs.set(key, ra)
    }
    ra.n++
    ra.c2 += c2
    ra.c3 += c3
    ra.c4p += c4p
    ra.sumAdditionalOrders += additional
    ra.sumLtv += ltv
    if (d2 !== null) ra.daysToSecond.push(d2)
  }

  const rows: FirstProductCascadeRow[] = [...rowAggs.values()].map((ra) => {
    const n = ra.n
    const avgDays =
      ra.daysToSecond.length > 0
        ? ra.daysToSecond.reduce((a, b) => a + b, 0) / ra.daysToSecond.length
        : null
    return {
      productKey: ra.productKey,
      productTitle: ra.productTitle,
      firstOrderCustomers: n,
      customersWith2ndOrder: ra.c2,
      customersWith3rdOrder: ra.c3,
      customersWith4thPlusOrder: ra.c4p,
      secondOrderRate: n > 0 ? (100 * ra.c2) / n : 0,
      thirdOrderRate: n > 0 ? (100 * ra.c3) / n : 0,
      fourthPlusRate: n > 0 ? (100 * ra.c4p) / n : 0,
      additionalOrderRate: n > 0 ? ra.sumAdditionalOrders / n : 0,
      averageLtv: n > 0 ? ra.sumLtv / n : 0,
      averageDaysToSecondOrder: avgDays !== null ? Math.round(avgDays * 10) / 10 : null,
    }
  })

  rows.sort((a, b) => b.firstOrderCustomers - a.firstOrderCustomers)

  return {
    from: params.fromYyyyMmDd,
    to: params.toYyyyMmDd,
    observationDaysAfterTo: observationDays,
    observationEnd: observationEnd.toISOString().slice(0, 10),
    currency: params.storeCurrency,
    rows,
    totalCohortCustomers: firstOrderByNormEmail.size,
  }
}
