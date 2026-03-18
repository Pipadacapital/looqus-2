/**
 * First-product → repeat purchase cascade (v1).
 *
 * ## Cohort definition
 * Customers whose **first included order** (same semantics as `fetchCustomerFirstOrdersInRange`)
 * has `processedAt` in `[fromDate, toDate]`.
 *
 * ## Primary first product (exactly one cohort per customer)
 * On that first order, line items are ranked:
 * 1. **Line revenue** descending: `Number(price) × quantity`
 * 2. **productShopifyId** ascending, with **null last** (sentinel `\uFFFF`)
 * 3. **Line item id** ascending (UUID string — stable DB tie-break)
 *
 * The **top line** after this sort defines the cohort. Customers with **no line items** on the
 * first order are grouped under key `__empty_first_order__` (data-quality bucket).
 *
 * ## Observation window
 * Repeat behavior and LTV are measured through **observation end** = end of `toDate` plus
 * `observationDaysAfterTo` calendar days (default 365). Only included orders with
 * `processedAt <= observationEnd` count.
 *
 * ## Order counts
 * Per customer, included orders from **first order time onward**, chronologically
 * (`processedAt`, then `id`): 1st / 2nd / 3rd / 4+ by count.
 *
 * ## Rates (percent 0–100)
 * - `secondOrderRate` = 100 × (customers with ≥2 orders) / cohort customers
 * - `thirdOrderRate` = 100 × (≥3) / cohort
 * - `fourthPlusRate` = 100 × (≥4) / cohort
 *
 * ## additionalOrderRate
 * Mean **extra** included orders per customer after the first, through observation end:
 * `sum(max(0, orderCount - 1)) / cohortSize`.
 *
 * ## LTV (v1 — revenue only)
 * Per customer: **sum of `totalPrice`** on all included orders from first order through
 * observation end (store currency, no CM2 — not shared as a per-customer primitive here).
 * `averageLtv` = mean of that sum over the cohort row.
 *
 * ## averageDaysToSecondOrder
 * Among customers with ≥2 orders: mean calendar days from first to second included order
 * (`differenceInCalendarDays`). If no such customers in the product row, `null`.
 */

import { differenceInCalendarDays } from 'date-fns'
import type { PrismaClient } from '@prisma/client'
import { getOrderInclusionWhere, type OrderFilterSettings } from '@/lib/order-filters'
import { fetchCustomerFirstOrdersInRange } from './customer-first-order'

const NULL_PID = '\uFFFF'
export const EMPTY_FIRST_ORDER_KEY = '__empty_first_order__'
export const NO_PRODUCT_KEY = '__no_product__'

const CUSTOMER_CHUNK = 2500

type LinePick = {
  id: string
  orderId: string
  productShopifyId: string | null
  price: { toString(): string }
  quantity: number
  title: string
}

function lineRevenue(li: LinePick): number {
  return Number(li.price) * li.quantity
}

/** Deterministic primary line on first order (see module doc). */
export function pickPrimaryFirstProductLine(lines: LinePick[]): LinePick | null {
  if (lines.length === 0) return null
  return [...lines].sort((a, b) => {
    const ra = lineRevenue(a)
    const rb = lineRevenue(b)
    if (rb !== ra) return rb - ra
    const pa = a.productShopifyId ?? NULL_PID
    const pb = b.productShopifyId ?? NULL_PID
    const c = pa.localeCompare(pb)
    if (c !== 0) return c
    return a.id.localeCompare(b.id)
  })[0]!
}

export type FirstProductCascadeRow = {
  productKey: string
  productTitle: string
  firstOrderCustomers: number
  customersWith2ndOrder: number
  customersWith3rdOrder: number
  customersWith4thPlusOrder: number
  secondOrderRate: number
  thirdOrderRate: number
  fourthPlusRate: number
  additionalOrderRate: number
  averageLtv: number
  averageDaysToSecondOrder: number | null
}

export type FirstProductCascadeResult = {
  from: string
  to: string
  observationDaysAfterTo: number
  observationEnd: string
  currency: string | null
  rows: FirstProductCascadeRow[]
  totalCohortCustomers: number
}

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

export async function computeFirstProductCascade(
  prisma: PrismaClient,
  connectionId: string,
  orderFilterSettings: OrderFilterSettings,
  params: {
    fromYyyyMmDd: string
    toYyyyMmDd: string
    observationDaysAfterTo?: number
  }
): Promise<FirstProductCascadeResult> {
  const observationDays = params.observationDaysAfterTo ?? 365
  const fromDate = new Date(params.fromYyyyMmDd + 'T00:00:00.000Z')
  const toDate = endOfUtcDay(new Date(params.toYyyyMmDd + 'T00:00:00.000Z'))
  const observationEnd = endOfUtcDay(addUtcDays(toDate, observationDays))

  const inclusionWhere = getOrderInclusionWhere(orderFilterSettings)

  const firstOrders = await fetchCustomerFirstOrdersInRange(
    prisma,
    connectionId,
    fromDate,
    toDate,
    orderFilterSettings
  )

  if (firstOrders.length === 0) {
    return {
      from: params.fromYyyyMmDd,
      to: params.toYyyyMmDd,
      observationDaysAfterTo: observationDays,
      observationEnd: observationEnd.toISOString().slice(0, 10),
      currency: null,
      rows: [],
      totalCohortCustomers: 0,
    }
  }

  const firstOrderIdSet = new Set(firstOrders.map((r) => r.order_id))
  const lineItems = await prisma.shopifyLineItem.findMany({
    where: { orderId: { in: [...firstOrderIdSet] } },
    select: {
      id: true,
      orderId: true,
      productShopifyId: true,
      price: true,
      quantity: true,
      title: true,
    },
  })

  const linesByOrder = new Map<string, LinePick[]>()
  for (const li of lineItems) {
    const list = linesByOrder.get(li.orderId) ?? []
    list.push(li)
    linesByOrder.set(li.orderId, list)
  }

  const productIds = [
    ...new Set(
      lineItems.map((l) => l.productShopifyId).filter((x): x is string => Boolean(x))
    ),
  ]
  const products = await prisma.shopifyProduct.findMany({
    where: { connectionId, shopifyId: { in: productIds } },
    select: { shopifyId: true, title: true },
  })
  const productTitleByShopifyId = new Map(products.map((p) => [p.shopifyId, p.title]))

  /** customer -> { productKey, productTitle } */
  const cohortByCustomer = new Map<string, { productKey: string; productTitle: string }>()
  for (const fo of firstOrders) {
    const lines = linesByOrder.get(fo.order_id) ?? []
    const primary = pickPrimaryFirstProductLine(lines)
    if (!primary) {
      cohortByCustomer.set(fo.customer_shopify_id, {
        productKey: EMPTY_FIRST_ORDER_KEY,
        productTitle: 'Empty first order',
      })
      continue
    }
    const key = primary.productShopifyId ?? NO_PRODUCT_KEY
    const title =
      (primary.productShopifyId && productTitleByShopifyId.get(primary.productShopifyId)) ||
      primary.title ||
      key
    cohortByCustomer.set(fo.customer_shopify_id, { productKey: key, productTitle: title })
  }

  const customerIds = firstOrders.map((r) => r.customer_shopify_id)
  const firstAtByCustomer = new Map(
    firstOrders.map((r) => [r.customer_shopify_id, r.first_at] as const)
  )
  type OrderRow = {
    processedAt: Date
    id: string
    totalPrice: { toString(): string }
  }
  const byCustomer = new Map<string, OrderRow[]>()
  for (let i = 0; i < customerIds.length; i += CUSTOMER_CHUNK) {
    const chunk = customerIds.slice(i, i + CUSTOMER_CHUNK)
    const orders = await prisma.shopifyOrder.findMany({
      where: {
        connectionId,
        customerShopifyId: { in: chunk },
        processedAt: { lte: observationEnd },
        ...inclusionWhere,
      },
      select: {
        id: true,
        customerShopifyId: true,
        processedAt: true,
        totalPrice: true,
      },
      orderBy: [{ processedAt: 'asc' }, { id: 'asc' }],
    })
    for (const o of orders) {
      const cid = o.customerShopifyId
      if (!cid) continue
      const firstAt = firstAtByCustomer.get(cid)
      if (!firstAt) continue
      if (o.processedAt < firstAt) continue
      let list = byCustomer.get(cid)
      if (!list) {
        list = []
        byCustomer.set(cid, list)
      }
      list.push(o)
    }
  }

  const currencyRow = await prisma.shopifyOrder.findFirst({
    where: { id: firstOrders[0]!.order_id },
    select: { currency: true },
  })
  const currency: string | null = currencyRow?.currency ?? null

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

  for (const fo of firstOrders) {
    const cid = fo.customer_shopify_id
    const cohort = cohortByCustomer.get(cid)
    if (!cohort) continue

    const list = byCustomer.get(cid) ?? []
    const sorted = [...list].sort((a, b) => {
      const t = a.processedAt.getTime() - b.processedAt.getTime()
      if (t !== 0) return t
      return a.id.localeCompare(b.id)
    })

    const nOrders = sorted.length
    const c2 = nOrders >= 2 ? 1 : 0
    const c3 = nOrders >= 3 ? 1 : 0
    const c4p = nOrders >= 4 ? 1 : 0
    const additional = Math.max(0, nOrders - 1)
    const ltv = sorted.reduce((s, o) => s + Number(o.totalPrice), 0)

    let d2: number | null = null
    if (nOrders >= 2) {
      const first = sorted[0]!
      const second = sorted[1]!
      d2 = differenceInCalendarDays(second.processedAt, first.processedAt)
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
    currency,
    rows,
    totalCohortCustomers: firstOrders.length,
  }
}
