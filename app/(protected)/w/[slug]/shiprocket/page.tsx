import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { ShiprocketContent } from './shiprocket-content'

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

  const today = new Date()
  const defaultFrom = new Date(today)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29)
  const fromStr =
    typeof sp.from === 'string' ? sp.from : defaultFrom.toISOString().slice(0, 10)
  const toStr =
    typeof sp.to === 'string' ? sp.to : today.toISOString().slice(0, 10)
  const fromDate = new Date(`${fromStr}T00:00:00.000Z`)
  const toDate = new Date(`${toStr}T23:59:59.999Z`)

  let totalShipmentCount = 0
  let totalOrderCount = 0
  let filteredShipmentCount = 0
  type ShipmentData = {
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
  let shipments: ShipmentData[] = []

  if (conn && isConnected) {
    const dateFilter = {
      OR: [
        {
          shiprocketCreatedAt: { gte: fromDate, lte: toDate },
        },
        {
          shiprocketCreatedAt: null,
          syncedAt: { gte: fromDate, lte: toDate },
        },
      ],
    }

    ;[totalShipmentCount, totalOrderCount, filteredShipmentCount] =
      await Promise.all([
        prisma.shiprocketShipment.count({ where: { connectionId: conn.id } }),
        prisma.shiprocketOrder.count({ where: { connectionId: conn.id } }),
        prisma.shiprocketShipment.count({
          where: { connectionId: conn.id, ...dateFilter },
        }),
      ])

    const rows = await prisma.shiprocketShipment.findMany({
      where: { connectionId: conn.id, ...dateFilter },
      orderBy: [
        { shiprocketCreatedAt: { sort: 'desc', nulls: 'last' } },
        { syncedAt: 'desc' },
      ],
      take: 500,
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
    })

    shipments = rows.map((r) => ({
      ...r,
      shippedAt: r.shippedAt?.toISOString() ?? null,
      shiprocketCreatedAt: r.shiprocketCreatedAt?.toISOString() ?? null,
      syncedAt: r.syncedAt.toISOString(),
    }))
  }

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
      filteredShipmentCount={filteredShipmentCount}
      shipments={shipments}
      dateFrom={fromStr}
      dateTo={toStr}
    />
  )
}
