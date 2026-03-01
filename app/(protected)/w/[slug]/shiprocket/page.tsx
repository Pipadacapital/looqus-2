import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { ShiprocketContent } from './shiprocket-content'
import {
  parseShiprocketListParams,
  buildShiprocketWhere,
  getPageSizeOptions,
} from '@/lib/shiprocket-list'

export type ShipmentData = {
  id: string
  shipmentId: string
  channelOrderId: string | null
  orderId: string | null
  awbCode: string | null
  courierName: string | null
  status: string | null
  statusCode: number | null
  trackingStatusCode: number | null
  trackingStatus: string | null
  paymentMethod: string | null
  shopifyOrderName: string | null
  isCod: boolean
  shippedAt: string | null
  shiprocketCreatedAt: string | null
  syncedAt: string
  rawJson: unknown
}

export default async function ShiprocketPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      shiprocketConnection: {
        select: {
          id: true,
          email: true,
          status: true,
          channels: true,
          selectedChannelIds: true,
          lastSyncAt: true,
          lastSyncError: true,
          createdAt: true,
        },
      },
    },
  })

  if (!workspace) redirect('/')

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: workspace.id, userId: user.id },
    select: { role: true },
  })

  if (!membership) redirect('/')

  const conn = workspace.shiprocketConnection
  const isConnected = conn?.status === 'CONNECTED'

  const listParams = parseShiprocketListParams(sp)

  let totalShipmentCount = 0
  let totalOrderCount = 0
  let filteredCount = 0
  let filteredCountInRange = 0
  let filteredOrderCountInRange = 0
  let deliveredCount = 0
  let rtoCount = 0
  let mappedCount = 0
  let shipments: ShipmentData[] = []
  let showAllFallback = false
  let baseWhere: ReturnType<typeof buildShiprocketWhere> | null = null

  if (conn && isConnected) {
    const dateFilter = {
      OR: [
        {
          shiprocketCreatedAt: {
            gte: new Date(`${listParams.from}T00:00:00.000Z`),
            lte: new Date(`${listParams.to}T23:59:59.999Z`),
          },
        },
        {
          shiprocketCreatedAt: null,
          syncedAt: {
            gte: new Date(`${listParams.from}T00:00:00.000Z`),
            lte: new Date(`${listParams.to}T23:59:59.999Z`),
          },
        },
      ],
    }

    const fromDate = new Date(`${listParams.from}T00:00:00.000Z`)
    const toDate = new Date(`${listParams.to}T23:59:59.999Z`)

    const [totalShipmentCountRes, totalOrderCountRes, filteredCountInRangeRes, filteredOrderCountInRangeRes] =
      await Promise.all([
        prisma.shiprocketShipment.count({ where: { connectionId: conn.id } }),
        prisma.shiprocketOrder.count({ where: { connectionId: conn.id } }),
        prisma.shiprocketShipment.count({
          where: { connectionId: conn.id, ...dateFilter },
        }),
        prisma.shiprocketOrder.count({
          where: {
            connectionId: conn.id,
            orderDate: { not: null, gte: fromDate, lte: toDate },
          },
        }),
      ])

    totalShipmentCount = totalShipmentCountRes
    totalOrderCount = totalOrderCountRes
    filteredCountInRange = filteredCountInRangeRes
    filteredOrderCountInRange = filteredOrderCountInRangeRes

    const useDateFilter = filteredCountInRange > 0
    baseWhere = buildShiprocketWhere(conn.id, listParams, {
      skipDateFilter: !useDateFilter,
    })

    const [totalFiltered, rows, deliveredCountRes, rtoCountRes, mappedCountRes] =
      await Promise.all([
        prisma.shiprocketShipment.count({ where: baseWhere }),
        prisma.shiprocketShipment.findMany({
          where: baseWhere,
          orderBy: [
            { shiprocketCreatedAt: { sort: 'desc', nulls: 'last' } },
            { syncedAt: 'desc' },
          ],
          skip: (listParams.page - 1) * listParams.pageSize,
          take: listParams.pageSize,
          select: {
            id: true,
            shipmentId: true,
            channelOrderId: true,
            orderId: true,
            awbCode: true,
            courierName: true,
            status: true,
            statusCode: true,
            trackingStatusCode: true,
            trackingStatus: true,
            paymentMethod: true,
            shopifyOrderName: true,
            isCod: true,
            shippedAt: true,
            shiprocketCreatedAt: true,
            syncedAt: true,
            rawJson: true,
          },
        }),
        prisma.shiprocketShipment.count({
          where: {
            AND: [
              baseWhere,
              { status: { contains: 'DELIVER', mode: 'insensitive' } },
            ],
          },
        }),
        prisma.shiprocketShipment.count({
          where: {
            AND: [
              baseWhere,
              { status: { contains: 'RTO', mode: 'insensitive' } },
            ],
          },
        }),
        prisma.shiprocketShipment.count({
          where: {
            AND: [baseWhere, { shopifyOrderName: { not: null } }],
          },
        }),
      ])

    filteredCount = totalFiltered
    deliveredCount = deliveredCountRes
    rtoCount = rtoCountRes
    mappedCount = mappedCountRes
    shipments = rows.map((r) => ({
      ...r,
      shippedAt: r.shippedAt?.toISOString() ?? null,
      shiprocketCreatedAt: r.shiprocketCreatedAt?.toISOString() ?? null,
      syncedAt: r.syncedAt.toISOString(),
    }))

    showAllFallback = Boolean(
      totalShipmentCount > 0 && filteredCountInRange === 0
    )
  }

  const totalPages = Math.max(
    1,
    Math.ceil(filteredCount / listParams.pageSize)
  )
  const safePage = Math.min(listParams.page, totalPages)

  const distinctStatusesFromPage = [
    ...new Set(
      shipments.map((s) => s.status).filter((x): x is string => Boolean(x))
    ),
  ].sort()

  return (
    <ShiprocketContent
      slug={slug}
      workspaceId={workspace.id}
      connection={
        conn
          ? {
              email: conn.email,
              status: conn.status,
              lastSyncAt: conn.lastSyncAt?.toISOString() ?? null,
              lastSyncError: conn.lastSyncError,
              createdAt: conn.createdAt.toISOString(),
            }
          : null
      }
      channels={
        conn && Array.isArray(conn.channels)
          ? (conn.channels as Array<{ id: number; name: string }>)
          : []
      }
      selectedChannelIds={conn?.selectedChannelIds ?? []}
      totalShipmentCount={totalShipmentCount}
      totalOrderCount={totalOrderCount}
      filteredShipmentCount={filteredCount}
      filteredCountInRange={filteredCountInRange}
      filteredOrderCountInRange={filteredOrderCountInRange}
      deliveredCount={deliveredCount}
      rtoCount={rtoCount}
      mappedCount={mappedCount}
      shipments={shipments}
      dateFrom={listParams.from}
      dateTo={listParams.to}
      showAllFallback={showAllFallback}
      pagination={{
        page: safePage,
        pageSize: listParams.pageSize,
        totalCount: filteredCount,
        totalPages,
      }}
      filters={{
        search: listParams.search ?? '',
        statuses: listParams.statuses,
        channelNames: listParams.channelNames,
        payment: listParams.payment,
        mapping: listParams.mapping,
        rtoOnly: listParams.rtoOnly,
      }}
      distinctStatusesFromPage={distinctStatusesFromPage}
      pageSizeOptions={[...getPageSizeOptions()]}
    />
  )
}
