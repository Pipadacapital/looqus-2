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
      platform: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true, lastSyncAt: true },
        take: 1,
      },
      woocommerceConnection: {
        select: { id: true, lastSyncAt: true, status: true },
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

  const shopifyConnection = workspace.shopifyConnections[0] ?? null
  const woocommerceConnection =
    workspace.woocommerceConnection?.status === 'CONNECTED'
      ? workspace.woocommerceConnection
      : null
  const isWoocommerce = workspace.platform === 'WOOCOMMERCE'
  const activeConnection = isWoocommerce ? woocommerceConnection : shopifyConnection

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

  if (activeConnection) {
    const connectionId = activeConnection.id
    const page = 1
    const pageSize = 10
    const orderDir = 'desc' as const

    const [orders, total] = isWoocommerce
      ? await Promise.all([
          prisma.woocommerceOrder.findMany({
            where: { connectionId },
            orderBy: { dateCreated: orderDir },
            skip: 0,
            take: pageSize,
            select: {
              id: true,
              orderNumber: true,
              customerEmail: true,
              total: true,
              currency: true,
              status: true,
              dateCreated: true,
            },
          }),
          prisma.woocommerceOrder.count({
            where: { connectionId },
          }),
        ])
      : await Promise.all([
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
      data: isWoocommerce
        ? orders.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber ?? String(o.id),
            name: o.orderNumber ?? `Order #${o.id}`,
            email: o.customerEmail,
            totalPrice: String(o.total ?? 0),
            currency: o.currency ?? '',
            financialStatus: o.status ?? '',
            fulfillmentStatus: null,
            processedAt: o.dateCreated?.toISOString() ?? new Date(0).toISOString(),
            cancelledAt: null,
          }))
        : orders.map((o) => ({
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
      platform={workspace.platform}
      hasConnection={!!activeConnection}
      connectionId={activeConnection?.id ?? null}
      lastSyncAt={activeConnection?.lastSyncAt?.toISOString() ?? null}
      initialOrders={initialOrders ?? undefined}
    />
  )
}
