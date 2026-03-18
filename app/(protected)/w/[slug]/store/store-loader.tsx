import { redirect } from 'next/navigation'
import { getCachedUser } from '@/lib/server-cache'
import { prisma } from '@/lib/prisma'
import { StoreContent } from './store-content'

export async function StoreLoader({ slug }: { slug: string }) {
  // Ensure the user can access this specific workspace (protected layout only checks "some"
  // membership, so we must re-check for the slug here).
  const user = await getCachedUser()
  if (!user) redirect('/auth/login')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true, lastSyncAt: true },
        take: 1,
      },
    },
  })

  if (!workspace) redirect('/')

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
    select: { id: true },
  })

  if (!membership) redirect('/')

  const connection = workspace.shopifyConnections[0] ?? null

  // Prefetch the first "Orders" page so the table doesn't wait for client-side `/api/...`.
  // This matches the default state inside `StoreOrdersTable` (page=1, pageSize=10, sort=processedAt, order=desc).
  let initialOrders:
    | {
        data: Array<{
          id: string
          orderNumber: string
          name: string
          email: string | null
          totalPrice: string
          currency: string
          financialStatus: string
          fulfillmentStatus: string | null
          processedAt: string
          cancelledAt: string | null
        }>
        total: number
        page: number
        pageSize: number
        totalPages: number
      }
    | null = null

  if (connection) {
    const connectionId = connection.id
    const page = 1
    const pageSize = 10
    const orderDir = 'desc' as const

    const [orders, total] = await Promise.all([
      prisma.shopifyOrder.findMany({
        where: { connectionId },
        orderBy: { processedAt: orderDir },
        skip: 0,
        take: pageSize,
        select: {
          id: true,
          orderNumber: true,
          name: true,
          email: true,
          totalPrice: true,
          currency: true,
          financialStatus: true,
          fulfillmentStatus: true,
          processedAt: true,
          cancelledAt: true,
        },
      }),
      prisma.shopifyOrder.count({
        where: { connectionId },
      }),
    ])

    initialOrders = {
      data: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        name: o.name,
        email: o.email,
        totalPrice: String(o.totalPrice),
        currency: o.currency,
        financialStatus: o.financialStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        processedAt: o.processedAt.toISOString(),
        cancelledAt: o.cancelledAt?.toISOString() ?? null,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  return (
    <StoreContent
      hasConnection={!!connection}
      connectionId={connection?.id ?? null}
      lastSyncAt={connection?.lastSyncAt?.toISOString() ?? null}
      initialOrders={initialOrders ?? undefined}
    />
  )
}
