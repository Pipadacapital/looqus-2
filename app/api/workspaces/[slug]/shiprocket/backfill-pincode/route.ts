import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { backfillShiprocketPincodes } from '@/lib/integrations/shiprocket-sync'

export const maxDuration = 300

/**
 * POST /api/workspaces/[slug]/shiprocket/backfill-pincode
 *
 * Enrichment backfill: populates deliveryPincode/City/State for historical Shiprocket
 * shipments. Uses (1) shipment rawJson, (2) linked order rawJson, (3) Shiprocket order API
 * when still missing. Persists to normalized fields. Owner-only. Safe to rerun.
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

  try {
    const result = await backfillShiprocketPincodes(conn.id)
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
