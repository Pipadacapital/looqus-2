import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { runFullBackfill } from '@/lib/shopify/bulk-operations'
import { createNotification } from '@/lib/notifications/create'
import type { BulkResourceType } from '@/lib/shopify/bulk-operations'

/**
 * POST /api/shopify/bulk-backfill
 *
 * Triggers a full bulk backfill of Shopify data using Shopify's Bulk Operations API.
 * This is designed for the initial 4-year historical data import.
 *
 * Body:
 *   connectionId: string (required)
 *   yearsBack?: number (default: 4)
 *   resources?: ('orders' | 'products' | 'customers')[] (default: all)
 *
 * The backfill runs in the background (fire-and-forget from the HTTP response perspective).
 * Progress and completion are tracked via console logs and notifications.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    connectionId?: string
    yearsBack?: number
    resources?: BulkResourceType[]
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    )
  }

  const { connectionId, yearsBack, resources } = body

  if (!connectionId) {
    return NextResponse.json(
      { error: 'Missing connectionId' },
      { status: 400 }
    )
  }

  // Validate resources if provided
  const validResources: BulkResourceType[] = ['orders', 'products', 'customers']
  if (resources) {
    for (const r of resources) {
      if (!validResources.includes(r)) {
        return NextResponse.json(
          { error: `Invalid resource: ${r}. Valid values: ${validResources.join(', ')}` },
          { status: 400 }
        )
      }
    }
  }

  // Verify connection exists and user has access
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
      { error: 'You do not have permission to run a bulk backfill' },
      { status: 403 }
    )
  }

  if (!connection.accessToken) {
    return NextResponse.json(
      { error: 'Store is not connected (missing access token)' },
      { status: 400 }
    )
  }

  // Fire-and-forget: start the backfill in the background
  // This avoids HTTP timeout issues since bulk operations can take a long time
  const backfillPromise = runFullBackfill(connectionId, {
    yearsBack,
    resources,
  })
    .then(async (result) => {
      const totalRecords = result.results.reduce(
        (sum, r) => sum + r.processedCount,
        0
      )
      const failedResources = result.results.filter(
        (r) => r.status === 'failed'
      )

      const summary = result.results
        .map((r) => {
          const status = r.status === 'completed' ? '✅' : '❌'
          return `${status} ${r.resource}: ${r.processedCount} records (${(r.durationMs / 1000).toFixed(1)}s)`
        })
        .join('\n')

      await createNotification({
        userId: user.id,
        workspaceId: connection.workspaceId,
        type: failedResources.length > 0 ? 'SYNC_FAILED' : 'SYNC_COMPLETED',
        title: failedResources.length > 0
          ? 'Bulk backfill partially failed'
          : 'Bulk backfill completed',
        body: `Backfill for ${connection.shopDomain}:\n${summary}\n\nTotal: ${totalRecords} records`,
        actionUrl: `/w/${connection.workspace.slug}/dashboard`,
      }).catch(() => {})
    })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : 'Bulk backfill failed'
      console.error('[BulkBackfill API] Fatal error:', message)

      await createNotification({
        userId: user.id,
        workspaceId: connection.workspaceId,
        type: 'SYNC_FAILED',
        title: 'Bulk backfill failed',
        body: `Backfill for ${connection.shopDomain} failed: ${message}`,
        actionUrl: `/w/${connection.workspace.slug}/dashboard`,
      }).catch(() => {})
    })

  // Don't await the promise – let it run in the background
  // In serverless environments (Vercel), use waitUntil if available
  if (typeof (globalThis as any).waitUntil === 'function') {
    ;(globalThis as any).waitUntil(backfillPromise)
  }

  return NextResponse.json({
    success: true,
    message: 'Bulk backfill started. You will be notified when it completes.',
    connectionId,
    shopDomain: connection.shopDomain,
    resources: resources ?? validResources,
    yearsBack: yearsBack ?? 4,
  })
}

/**
 * GET /api/shopify/bulk-backfill
 *
 * Returns the current status / last sync info for a connection.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const connectionId = request.nextUrl.searchParams.get('connectionId')
  if (!connectionId) {
    return NextResponse.json(
      { error: 'Missing connectionId query parameter' },
      { status: 400 }
    )
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      shopDomain: true,
      lastSyncAt: true,
      status: true,
      _count: {
        select: {
          orders: true,
          products: true,
          customers: true,
        },
      },
    },
  })

  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  return NextResponse.json({
    connectionId: connection.id,
    shopDomain: connection.shopDomain,
    lastSyncAt: connection.lastSyncAt,
    status: connection.status,
    counts: {
      orders: connection._count.orders,
      products: connection._count.products,
      customers: connection._count.customers,
    },
  })
}
