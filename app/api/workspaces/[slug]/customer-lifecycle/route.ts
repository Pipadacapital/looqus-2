import { NextResponse, type NextRequest } from 'next/server'
import { format } from 'date-fns'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { normalizeOrderFilterSettings } from '@/lib/order-filters'
import { computeCustomerLifecycleReport } from '@/lib/metrics/customer-lifecycle-report'

function parseYyyyMmDd(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export async function GET(
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
  const asOf =
    parseYyyyMmDd(searchParams.get('asOf')) ?? format(new Date(), 'yyyy-MM-dd')
  const trainingWindowDays = clamp(
    parseInt(searchParams.get('trainDays') ?? '365', 10) || 365,
    90,
    730
  )
  const revenueWindowDays = clamp(
    parseInt(searchParams.get('revenueDays') ?? '90', 10) || 90,
    7,
    365
  )

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
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  })
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return NextResponse.json(
      { error: 'No connected Shopify store', code: 'NO_SHOPIFY' },
      { status: 400 }
    )
  }

  const orderFilterSettings = normalizeOrderFilterSettings(workspace as any)

  const report = await computeCustomerLifecycleReport(prisma, connectionId, orderFilterSettings, {
    asOfYyyyMmDd: asOf,
    trainingWindowDays,
    revenueWindowDays,
  })

  return NextResponse.json(report)
}
