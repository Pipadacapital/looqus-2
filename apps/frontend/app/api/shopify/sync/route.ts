import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { syncOrders, syncProducts, syncCustomers } from '@/lib/shopify/sync'
import { createNotification } from '@/lib/notifications/create'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { connectionId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    )
  }

  const connectionId = body.connectionId
  if (!connectionId) {
    return NextResponse.json(
      { error: 'Missing connectionId' },
      { status: 400 }
    )
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    include: {
      workspace: {
        select: { id: true, slug: true },
      },
    },
  })

  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: connection.workspaceId,
      },
    },
  })

  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'You do not have permission to sync this store' },
      { status: 403 }
    )
  }

  if (!connection.accessToken) {
    return NextResponse.json(
      { error: 'Store is not connected (missing access token)' },
      { status: 400 }
    )
  }

  try {
    const [ordersResult, productsResult, customersResult] = await Promise.all([
      syncOrders(connectionId),
      syncProducts(connectionId),
      syncCustomers(connectionId),
    ])

    await prisma.shopifyConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    })

    await createNotification({
      userId: user.id,
      workspaceId: connection.workspaceId,
      type: 'SYNC_COMPLETED',
      title: 'Shopify sync completed',
      body: `Synced ${ordersResult.synced} orders, ${productsResult.synced} products, ${customersResult.synced} customers from ${connection.shopDomain}.`,
      actionUrl: `/w/${connection.workspace.slug}/dashboard`,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      orders: ordersResult.synced,
      products: productsResult.synced,
      customers: customersResult.synced,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    await createNotification({
      userId: user.id,
      workspaceId: connection.workspaceId,
      type: 'SYNC_FAILED',
      title: 'Shopify sync failed',
      body: message,
      actionUrl: `/w/${connection.workspace.slug}/dashboard`,
    }).catch(() => {})

    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
