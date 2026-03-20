/**
 * Pincode Intelligence v1.
 * Aggregates by delivery pincode using Shiprocket shipment data (pincode/city/state from rawJson)
 * and Shiprocket-only shipment values for revenue/orders. Same RTO/delivered/COD definitions as Logistics.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { buildShiprocketDateRangeWhere } from '@/lib/shiprocket-list'
import { getPincodeFromRaw, getCityFromRaw, getStateFromRaw, getCourierName, isCodShipment } from '@/lib/shiprocket-normalize'

const TIER_1_CITIES = new Set([
  'mumbai', 'delhi', 'bangalore', 'bengaluru', 'hyderabad', 'chennai', 'kolkata', 'pune', 'ahmedabad',
])
const TIER_2_CITIES = new Set([
  'jaipur', 'lucknow', 'surat', 'kanpur', 'nagpur', 'indore', 'bhopal', 'patna', 'vadodara', 'ludhiana',
  'agra', 'nashik', 'faridabad', 'meerut', 'rajkot', 'varanasi', 'srinagar', 'aurangabad', 'dhanbad',
  'amritsar', 'navi mumbai', 'allahabad', 'ranchi', 'howrah', 'coimbatore', 'jabalpur', 'gwalior',
  'vijayawada', 'jodhpur', 'madurai', 'raipur', 'kota', 'guwahati', 'chandigarh', 'solapur', 'hubballi',
  'tiruchirappalli', 'bareilly', 'mysuru', 'mysore', 'tiruppur', 'gurgaon', 'gurugram', 'noida', 'thane',
  'navi mumbai',
])

function isRtoByStatus(status: string | null): boolean {
  return (status ?? '').toUpperCase().includes('RTO')
}

function isDeliveredByStatus(status: string | null): boolean {
  return (status ?? '').toUpperCase().includes('DELIVER')
}

function normalizePincode(pin: string | null): string {
  const t = pin?.trim()
  return t && t.length > 0 ? t : '—'
}

function classifyTier(city: string): 1 | 2 | 3 | null {
  const c = city.trim().toLowerCase()
  if (!c || c === '—') return null
  if (TIER_1_CITIES.has(c)) return 1
  if (TIER_2_CITIES.has(c)) return 2
  return 3
}

function getNumberFromRaw(raw: unknown, key: string): number | null {
  if (raw == null || typeof raw !== 'object') return null
  const v = (raw as Record<string, unknown>)[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.trim())
    if (Number.isFinite(n)) return n
  }
  return null
}

function getStringFromRaw(raw: unknown, key: string): string | null {
  if (raw == null || typeof raw !== 'object') return null
  const v = (raw as Record<string, unknown>)[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function calcProfitabilityScore(rtoRate: number, codRate: number, repeatRate: number, aov: number): number {
  const rtoPenalty = rtoRate * 2
  const codPenalty = codRate * 0.5
  const repeatBonus = repeatRate * 0.5
  const aovBonus = (aov / 1000) * 10
  return Math.max(0, Math.min(100, 100 - rtoPenalty - codPenalty + repeatBonus + aovBonus))
}

export type PincodeIntelligenceRow = {
  pincode: string
  city: string
  state: string
  orders: number
  revenue: number
  aov: number | null
  shipmentCount: number
  rtoCount: number
  rtoPercent: number | null
  codCount: number
  codPercent: number | null
  deliveredCount: number
  deliveredPercent: number | null
  topCourier: string
  tier: 1 | 2 | 3 | null
  uniqueCustomers: number
  repeatRate: number | null
  profitabilityScore: number
  matchedShipments: null
}

export type PincodeIntelligenceResult = {
  rows: PincodeIntelligenceRow[]
  /** Total shipments in range (for coverage note). */
  totalShipments: number
  /** Shipments with a non-empty pincode extracted from rawJson. */
  shipmentsWithPincode: number
  matchedShipments: null
}

export type PincodeIntelligenceParams = {
  fromDate: Date
  toDate: Date
  shiprocketConnectionId: string
  shopifyConnectionId: string | null
  orderInclusionWhere: Prisma.ShopifyOrderWhereInput
  search?: string | null
  state?: string | null
  minOrders?: number
  highRtoOnly?: boolean
  highCodOnly?: boolean
  sort?: string
  order?: 'asc' | 'desc'
}

export async function getPincodeIntelligence(
  prisma: PrismaClient,
  params: PincodeIntelligenceParams
): Promise<PincodeIntelligenceResult> {
  const {
    fromDate,
    toDate,
    shiprocketConnectionId,
    shopifyConnectionId: _shopifyConnectionId,
    orderInclusionWhere: _orderInclusionWhere,
    search,
    state: stateFilter,
    minOrders = 0,
    highRtoOnly,
    highCodOnly,
    sort = 'orders',
    order: sortOrder = 'desc',
  } = params

  const dateWhere = buildShiprocketDateRangeWhere(fromDate, toDate)
  const shipments = await prisma.shiprocketShipment.findMany({
    where: {
      connectionId: shiprocketConnectionId,
      ...dateWhere,
    },
    select: {
      id: true,
      status: true,
      isCod: true,
      courierName: true,
      channelOrderId: true,
      shopifyOrderName: true,
      rawJson: true,
      deliveryPincode: true,
      deliveryCity: true,
      deliveryState: true,
    },
  })

  const totalShipments = shipments.length
  const orderIdSet = new Set<string>()
  for (const s of shipments) {
    const rawOrderId = getNumberFromRaw(s.rawJson, 'order_id')
    if (rawOrderId != null) orderIdSet.add(String(rawOrderId))
  }
  const orderIds = Array.from(orderIdSet)
  const shiprocketOrders = orderIds.length > 0
    ? await prisma.shiprocketOrder.findMany({
      where: {
        connectionId: shiprocketConnectionId,
        shiprocketId: { in: orderIds },
      },
      select: { shiprocketId: true, rawJson: true },
    })
    : []
  const orderRevenueByShiprocketId = new Map<string, number>()
  const orderCustomerPhoneByShiprocketId = new Map<string, string>()
  for (const o of shiprocketOrders) {
    const total = getNumberFromRaw(o.rawJson, 'total')
    if (total != null && total > 0) {
      orderRevenueByShiprocketId.set(o.shiprocketId, total)
    }
    const customerPhone = getStringFromRaw(o.rawJson, 'customer_phone')
    if (customerPhone) {
      orderCustomerPhoneByShiprocketId.set(o.shiprocketId, customerPhone)
    }
  }

  const customerIdByShipmentId = new Map<string, string>()
  const globalCustomerCounts = new Map<string, number>()
  for (const s of shipments) {
    const rawOrderId = getNumberFromRaw(s.rawJson, 'order_id')
    const fromOrder = rawOrderId != null
      ? orderCustomerPhoneByShiprocketId.get(String(rawOrderId)) ?? null
      : null
    const fromShipment = getStringFromRaw(s.rawJson, 'customer_phone')
    const customerId = fromOrder ?? fromShipment ?? s.id
    customerIdByShipmentId.set(s.id, customerId)
    globalCustomerCounts.set(customerId, (globalCustomerCounts.get(customerId) ?? 0) + 1)
  }
  const globalRepeatCustomers = new Set(
    Array.from(globalCustomerCounts.entries())
      .filter(([, count]) => count >= 2)
      .map(([customerId]) => customerId)
  )

  type Agg = {
    city: string
    state: string
    revenue: number
    shipmentCount: number
    rtoCount: number
    codCount: number
    deliveredCount: number
    courierCounts: Map<string, number>
    customerCounts: Map<string, number>
    uniqueCustomerIds: Set<string>
  }

  const byPincode = new Map<string, Agg>()

  for (const s of shipments) {
    const pin = normalizePincode((s.deliveryPincode?.trim() || null) ?? getPincodeFromRaw(s.rawJson))
    const city = (s.deliveryCity?.trim() || null) ?? getCityFromRaw(s.rawJson)?.trim() ?? '—'
    const stateVal = (s.deliveryState?.trim() || null) ?? getStateFromRaw(s.rawJson)?.trim() ?? '—'

    let agg = byPincode.get(pin)
    if (!agg) {
      agg = {
        city: city || '—',
        state: stateVal || '—',
        revenue: 0,
        shipmentCount: 0,
        rtoCount: 0,
        codCount: 0,
        deliveredCount: 0,
        courierCounts: new Map(),
        customerCounts: new Map(),
        uniqueCustomerIds: new Set(),
      }
      byPincode.set(pin, agg)
    }
    agg.shipmentCount++
    if (isRtoByStatus(s.status)) agg.rtoCount++
    if (isCodShipment(s)) agg.codCount++
    const delivered = isDeliveredByStatus(s.status)
    if (delivered) agg.deliveredCount++
    const courier = getCourierName(s)
    agg.courierCounts.set(courier, (agg.courierCounts.get(courier) ?? 0) + 1)
    const customerId = customerIdByShipmentId.get(s.id)
    if (customerId) {
      agg.customerCounts.set(customerId, (agg.customerCounts.get(customerId) ?? 0) + 1)
      agg.uniqueCustomerIds.add(customerId)
    }
    if (delivered && !isRtoByStatus(s.status)) {
      const rawOrderId = getNumberFromRaw(s.rawJson, 'order_id')
      if (rawOrderId != null) {
        const revenue = orderRevenueByShiprocketId.get(String(rawOrderId)) ?? 0
        agg.revenue += revenue
      }
    }
  }

  let rows: PincodeIntelligenceRow[] = Array.from(byPincode.entries()).map(([pincode, agg]) => {
    const orders = agg.shipmentCount
    const aov = agg.deliveredCount > 0 ? agg.revenue / agg.deliveredCount : null
    const rtoPercent = agg.shipmentCount > 0 ? Math.round((agg.rtoCount / agg.shipmentCount) * 10000) / 100 : null
    const codPercent = agg.shipmentCount > 0 ? Math.round((agg.codCount / agg.shipmentCount) * 10000) / 100 : null
    const deliveredPercent = agg.shipmentCount > 0 ? Math.round((agg.deliveredCount / agg.shipmentCount) * 10000) / 100 : null
    const topCourier =
      agg.courierCounts.size > 0
        ? [...agg.courierCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : '—'
    const uniqueCustomers = agg.customerCounts.size
    const repeatCustomers = Array.from(agg.uniqueCustomerIds).filter((id) => globalRepeatCustomers.has(id)).length
    const repeatRate =
      uniqueCustomers > 0 ? Math.round((repeatCustomers / uniqueCustomers) * 10000) / 100 : null
    const tier = classifyTier(agg.city)
    const profitabilityScore = Math.round(
      calcProfitabilityScore(rtoPercent ?? 0, codPercent ?? 0, repeatRate ?? 0, aov ?? 0) * 100
    ) / 100
    return {
      pincode,
      city: agg.city,
      state: agg.state,
      orders,
      revenue: Math.round(agg.revenue * 100) / 100,
      aov: aov != null ? Math.round(aov * 100) / 100 : null,
      shipmentCount: agg.shipmentCount,
      rtoCount: agg.rtoCount,
      rtoPercent,
      codCount: agg.codCount,
      codPercent,
      deliveredCount: agg.deliveredCount,
      deliveredPercent,
      topCourier,
      tier,
      uniqueCustomers,
      repeatRate,
      profitabilityScore,
      matchedShipments: null,
    }
  })

  const shipmentsWithPincode = shipments.filter((s) => {
    const pin = getPincodeFromRaw(s.rawJson)?.trim()
    return pin && pin.length > 0
  }).length

  if (search && search.trim()) {
    const q = search.trim().toLowerCase()
    rows = rows.filter(
      (r) =>
        r.pincode.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q) ||
        r.state.toLowerCase().includes(q)
    )
  }
  if (stateFilter && stateFilter.trim()) {
    const s = stateFilter.trim()
    rows = rows.filter((r) => r.state.toLowerCase() === s.toLowerCase())
  }
  if (minOrders > 0) {
    rows = rows.filter((r) => r.orders >= minOrders)
  }
  if (highRtoOnly) {
    rows = rows.filter((r) => r.rtoPercent != null && r.rtoPercent >= 20)
  }
  if (highCodOnly) {
    rows = rows.filter((r) => r.codPercent != null && r.codPercent >= 50)
  }

  const sortKey = sort || 'orders'
  rows.sort((a, b) => {
    let va: number | string = (a as Record<string, unknown>)[sortKey] as number | string
    let vb: number | string = (b as Record<string, unknown>)[sortKey] as number | string
    if (sortKey === 'pincode' || sortKey === 'city' || sortKey === 'state' || sortKey === 'topCourier') {
      va = String(va ?? '')
      vb = String(vb ?? '')
      return sortOrder === 'asc' ? (va < vb ? -1 : 1) : (vb < va ? -1 : 1)
    }
    const na = Number(va) || 0
    const nb = Number(vb) || 0
    return sortOrder === 'asc' ? na - nb : nb - na
  })

  return {
    rows,
    totalShipments,
    shipmentsWithPincode,
    matchedShipments: null,
  }
}
