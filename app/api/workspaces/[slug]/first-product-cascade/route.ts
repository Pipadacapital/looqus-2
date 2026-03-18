import { NextResponse, type NextRequest } from 'next/server'
import { startOfYear, endOfDay, format } from 'date-fns'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { normalizeOrderFilterSettings } from '@/lib/order-filters'
import { computeFirstProductCascade } from '@/lib/metrics/first-product-cascade'

function parseDate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
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
  const now = new Date()
  const from = parseDate(searchParams.get('from')) ?? format(startOfYear(now), 'yyyy-MM-dd')
  const to = parseDate(searchParams.get('to')) ?? format(endOfDay(now), 'yyyy-MM-dd')
  const obs = Math.min(730, Math.max(30, parseInt(searchParams.get('observationDays') ?? '365', 10) || 365))

  const fromDate = new Date(from + 'T00:00:00.000Z')
  const toDate = new Date(to + 'T23:59:59.999Z')
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

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

  const result = await computeFirstProductCascade(prisma, connectionId, orderFilterSettings, {
    fromYyyyMmDd: from,
    toYyyyMmDd: to,
    observationDaysAfterTo: obs,
  })

  return NextResponse.json(result)
}
