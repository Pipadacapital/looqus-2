import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { backfillOrders } from '@/lib/shopify/sync'

/**
 * POST: Run deep order backfill for this workspace's Shopify connection.
 * Owner/Admin only. Query: ?daysBack=400 (optional; default from env or 400).
 * Logs progress in server console (dev). Updates lastSyncAt on success.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const daysBackParam = searchParams.get('daysBack')
  const daysBack = daysBackParam != null ? Math.min(730, Math.max(1, parseInt(daysBackParam, 10) || 400)) : undefined

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })

  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only workspace owners and admins can run order backfill' },
      { status: 403 }
    )
  }

  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return NextResponse.json(
      { error: 'No connected Shopify store for this workspace' },
      { status: 400 }
    )
  }

  try {
    const result = await backfillOrders(connectionId, { daysBack })

    await prisma.shopifyConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    })

    if (process.env.NODE_ENV === 'development') {
      console.log(`[Backfill] Completed: synced=${result.synced} stoppedAt=${result.stoppedAt ?? 'n/a'}`)
    }

    return NextResponse.json({
      success: true,
      synced: result.synced,
      stoppedAt: result.stoppedAt ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backfill failed'
    if (process.env.NODE_ENV === 'development') {
      console.error('[Backfill]', message)
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
