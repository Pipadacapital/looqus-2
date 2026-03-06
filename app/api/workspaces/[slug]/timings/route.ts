import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { computeTimings } from '@/lib/timings/compute'
import type { TimingsGroupBy, TimingsMetric } from '@/lib/timings/types'

const METRICS: TimingsMetric[] = ['median', 'mean']
const GROUP_BY_OPTIONS: TimingsGroupBy[] = [
  'product',
  'variant',
  'vendor',
  'productType',
]

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
  const from = parseDate(searchParams.get('from'))
  const to = parseDate(searchParams.get('to'))
  const metric = searchParams.get('metric') as TimingsMetric | null
  const groupByParam = searchParams.get('groupBy') as TimingsGroupBy | null
  const groupId =
    searchParams.get('groupId') || searchParams.get('productId') || undefined

  if (!from || !to) {
    return NextResponse.json(
      { error: 'Missing or invalid from/to (YYYY-MM-DD)' },
      { status: 400 }
    )
  }
  const fromDate = new Date(from + 'T00:00:00.000Z')
  const toDate = new Date(to + 'T23:59:59.999Z')
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  const validMetric = metric && METRICS.includes(metric) ? metric : 'median'
  const validGroupBy =
    groupByParam && GROUP_BY_OPTIONS.includes(groupByParam)
      ? groupByParam
      : 'product'

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
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await computeTimings(prisma, workspace, {
    from,
    to,
    metric: validMetric,
    groupBy: validGroupBy,
    groupId,
  })

  return NextResponse.json(result)
}
