import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { backfillShiprocketCourierNames } from '@/lib/integrations/shiprocket-sync'

export const maxDuration = 300

/**
 * POST /api/workspaces/[slug]/shiprocket/backfill-courier
 *
 * Backfill ShiprocketShipment.courierName for existing rows where it is null.
 * One request: (1) Process ALL candidates from rawJson; (2) Up to trackingBatchPerRequest
 * via tracking API. Call repeatedly until completedFully for full one-click repair.
 *
 * Owner-only. Use so Logistics "By Courier" works for already-synced date ranges.
 *
 * Body (optional): { "trackingBatchPerRequest": 150 } — max tracking API calls per request (0–200).
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

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shiprocketConnection: { select: { id: true, status: true } },
      members: { where: { userId: user.id }, select: { role: true } },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  if (workspace.members[0]?.role !== 'OWNER') {
    return NextResponse.json(
      { error: 'Only workspace owners can run this backfill' },
      { status: 403 }
    )
  }

  const conn = workspace.shiprocketConnection
  if (!conn || conn.status !== 'CONNECTED') {
    return NextResponse.json(
      { error: 'No connected Shiprocket connection for this workspace' },
      { status: 400 }
    )
  }

  let trackingBatchPerRequest = 150
  try {
    const body = await request.json().catch(() => ({}))
    if (body?.trackingBatchPerRequest != null) {
      const n = typeof body.trackingBatchPerRequest === 'number' ? body.trackingBatchPerRequest : parseInt(String(body.trackingBatchPerRequest), 10)
      if (!Number.isNaN(n)) trackingBatchPerRequest = Math.min(Math.max(n, 0), 200)
    }
  } catch {
    // use default
  }

  try {
    const result = await backfillShiprocketCourierNames(conn.id, { trackingBatchPerRequest })
    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Backfill failed',
      },
      { status: 500 }
    )
  }
}
