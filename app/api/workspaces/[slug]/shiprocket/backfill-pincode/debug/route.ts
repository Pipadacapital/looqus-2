import { NextResponse } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { debugPincodeBackfillTrace } from '@/lib/integrations/shiprocket-sync'

/**
 * GET /api/workspaces/[slug]/shiprocket/backfill-pincode/debug
 *
 * Traces 3–5 unresolved ShiprocketShipment rows (deliveryPincode null) and returns
 * which phase could supply pincode: shipment rawJson keys, linked order existence
 * and order rawJson keys, and order-by-id API response shape. Owner-only. Use to
 * identify which phase is failing before fixing the backfill.
 */
export async function GET(
  _request: Request,
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
      { error: 'Only workspace owners can run this debug' },
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

  try {
    const result = await debugPincodeBackfillTrace(conn.id, { sampleSize: 5 })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Debug trace failed',
      },
      { status: 500 }
    )
  }
}
