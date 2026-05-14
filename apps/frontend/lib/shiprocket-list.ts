import type { Prisma } from '@prisma/client'

/**
 * Effective shipment date: shippedAt ?? shiprocketCreatedAt.
 * Aligns list and analytics on the same date convention for "in range".
 * Use syncedAt only when both are null (e.g. list fallback).
 */
export function getEffectiveShipmentDate(shipment: {
  shippedAt?: Date | null
  shiprocketCreatedAt?: Date | null
}): Date | null {
  const d = shipment.shippedAt ?? shipment.shiprocketCreatedAt ?? null
  return d instanceof Date ? d : null
}

const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
const MAX_PAGE_SIZE = 100

/** Prisma where for "effective shipment date in range" (shippedAt ?? shiprocketCreatedAt; fallback syncedAt). */
export function buildShiprocketDateRangeWhere(
  fromDate: Date,
  toDate: Date
): Prisma.ShiprocketShipmentWhereInput {
  return {
    OR: [
      { shippedAt: { gte: fromDate, lte: toDate } },
      {
        shippedAt: null,
        shiprocketCreatedAt: { gte: fromDate, lte: toDate },
      },
      {
        shippedAt: null,
        shiprocketCreatedAt: null,
        syncedAt: { gte: fromDate, lte: toDate },
      },
    ],
  }
}

export type ShiprocketListParams = {
  from: string
  to: string
  page: number
  pageSize: number
  search: string | null
  statuses: string[]
  channelNames: string[]
  payment: 'COD' | 'PREPAID' | null
  mapping: 'MATCHED' | 'UNMATCHED' | null
  rtoOnly: boolean
}

export function parseShiprocketListParams(
  sp: Record<string, string | string[] | undefined>
): ShiprocketListParams {
  const today = new Date()
  const defaultFrom = new Date(today)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 89)

  const fromStr =
    typeof sp.from === 'string' ? sp.from : defaultFrom.toISOString().slice(0, 10)
  const toStr =
    typeof sp.to === 'string' ? sp.to : today.toISOString().slice(0, 10)

  const page = Math.max(
    1,
    parseInt(typeof sp.page === 'string' ? sp.page : '', 10) || 1
  )
  const rawPageSize = parseInt(
    typeof sp.pageSize === 'string' ? sp.pageSize : '',
    10
  )
  const pageSize = PAGE_SIZE_OPTIONS.includes(rawPageSize as (typeof PAGE_SIZE_OPTIONS)[number])
    ? rawPageSize
    : DEFAULT_PAGE_SIZE
  const cappedPageSize = Math.min(pageSize, MAX_PAGE_SIZE)

  const search =
    typeof sp.q === 'string' ? sp.q.trim() || null : null
  const statuses =
    typeof sp.status === 'string'
      ? sp.status
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  const channelNames =
    typeof sp.channel === 'string'
      ? sp.channel
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : []
  const payment =
    sp.payment === 'COD'
      ? 'COD'
      : sp.payment === 'PREPAID'
        ? 'PREPAID'
        : null
  const mapping =
    sp.mapping === 'MATCHED'
      ? 'MATCHED'
      : sp.mapping === 'UNMATCHED'
        ? 'UNMATCHED'
        : null
  const rtoOnly =
    sp.rtoOnly === '1' || sp.rtoOnly === 'true'

  return {
    from: fromStr,
    to: toStr,
    page,
    pageSize: cappedPageSize,
    search,
    statuses,
    channelNames,
    payment,
    mapping,
    rtoOnly,
  }
}

export function buildShiprocketWhere(
  connectionId: string,
  params: ShiprocketListParams,
  options?: { skipDateFilter?: boolean }
): Prisma.ShiprocketShipmentWhereInput {
  const fromDate = new Date(`${params.from}T00:00:00.000Z`)
  const toDate = new Date(`${params.to}T23:59:59.999Z`)
  const dateFilter = buildShiprocketDateRangeWhere(fromDate, toDate)

  const conditions: Prisma.ShiprocketShipmentWhereInput[] = [
    { connectionId },
  ]

  if (!options?.skipDateFilter) {
    conditions.push(dateFilter)
  }

  if (params.search) {
    const q = params.search
    conditions.push({
      OR: [
        { shipmentId: { contains: q, mode: 'insensitive' } },
        { orderId: { contains: q, mode: 'insensitive' } },
        { channelOrderId: { contains: q, mode: 'insensitive' } },
        { awbCode: { contains: q, mode: 'insensitive' } },
        { shopifyOrderName: { contains: q, mode: 'insensitive' } },
      ],
    })
  }

  if (params.rtoOnly) {
    conditions.push({
      status: { contains: 'RTO', mode: 'insensitive' },
    })
  } else if (params.statuses.length > 0) {
    conditions.push({ status: { in: params.statuses } })
  }

  if (params.payment === 'COD') {
    conditions.push({ isCod: true })
  } else if (params.payment === 'PREPAID') {
    conditions.push({ isCod: false })
  }

  if (params.mapping === 'MATCHED') {
    conditions.push({ shopifyOrderName: { not: null } })
  } else if (params.mapping === 'UNMATCHED') {
    conditions.push({ shopifyOrderName: null })
  }

  if (params.channelNames.length > 0) {
    conditions.push({
      OR: params.channelNames.map((name) => ({
        rawJson: {
          path: ['channel_name'],
          equals: name,
        } as Prisma.JsonNullableFilter,
      })),
    })
  }

  return { AND: conditions }
}

export function getDefaultPageSize(): number {
  return DEFAULT_PAGE_SIZE
}

export function getPageSizeOptions(): readonly number[] {
  return PAGE_SIZE_OPTIONS
}
