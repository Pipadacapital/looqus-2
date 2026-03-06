import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { runFullBackfill } from '@/lib/shopify/bulk-operations'
import { createNotification } from '@/lib/notifications/create'
import type { BulkResourceType } from '@/lib/shopify/bulk-operations'

/**
 * POST /api/workspaces/[slug]/shopify/bulk-backfill
 *
 * Triggers a full bulk backfill of Shopify data using Shopify's Bulk Operations API.
 * Automatically resolves the connectionId from the workspace — no need to pass it.
 *
 * Body (all optional):
 *   yearsBack?: number (default: 4)
 *   resources?: ('orders' | 'products' | 'customers')[] (default: all)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Resolve workspace + connection from slug
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true, shopDomain: true, accessToken: true },
        take: 1,
      },
      members: {
        where: { userId: user.id },
        select: { role: true },
        take: 1,
      },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = workspace.members[0]
  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'You do not have permission to run a bulk backfill' },
      { status: 403 }
    )
  }

  const connection = workspace.shopifyConnections[0]
  if (!connection) {
    return NextResponse.json(
      { error: 'No connected Shopify store found for this workspace' },
      { status: 400 }
    )
  }

  if (!connection.accessToken) {
    return NextResponse.json(
      { error: 'Store is not connected (missing access token)' },
      { status: 400 }
    )
  }

  // Parse optional body
  let body: {
    yearsBack?: number
    resources?: BulkResourceType[]
  } = {}

  try {
    body = await request.json()
  } catch {
    // Body is optional — defaults are fine
  }

  const { yearsBack, resources } = body

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

  const connectionId = connection.id

  // Fire-and-forget: start the backfill in the background
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
          const icon = r.status === 'completed' ? '✅' : '❌'
          return `${icon} ${r.resource}: ${r.processedCount} records (${(r.durationMs / 1000).toFixed(1)}s)`
        })
        .join('\n')

      await createNotification({
        userId: user.id,
        workspaceId: workspace.id,
        type: failedResources.length > 0 ? 'SYNC_FAILED' : 'SYNC_COMPLETED',
        title: failedResources.length > 0
          ? 'Bulk backfill partially failed'
          : 'Bulk backfill completed',
        body: `Backfill for ${connection.shopDomain}:\n${summary}\n\nTotal: ${totalRecords} records`,
        actionUrl: `/w/${slug}/dashboard`,
      }).catch(() => {})
    })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : 'Bulk backfill failed'
      console.error('[BulkBackfill API] Fatal error:', message)

      await createNotification({
        userId: user.id,
        workspaceId: workspace.id,
        type: 'SYNC_FAILED',
        title: 'Bulk backfill failed',
        body: `Backfill for ${connection.shopDomain} failed: ${message}`,
        actionUrl: `/w/${slug}/dashboard`,
      }).catch(() => {})
    })

  // In serverless environments, use waitUntil if available
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
 * GET /api/workspaces/[slug]/shopify/bulk-backfill
 *
 * Returns current record counts for the connected Shopify store.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
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
        take: 1,
      },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const connection = workspace.shopifyConnections[0]
  if (!connection) {
    return NextResponse.json(
      { error: 'No connected Shopify store found' },
      { status: 400 }
    )
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
