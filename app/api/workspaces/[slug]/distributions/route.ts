import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { computeDistributions } from '@/lib/distributions/compute'
import type { DistributionsMetric, DistributionsSortColumn } from '@/lib/distributions/compute'

function parseDate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

const SORT_COLUMNS: DistributionsSortColumn[] = ['product', 'orders', 'mode', 'mean', 'diff']

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
  const metric = (searchParams.get('metric') ?? 'cm1') as DistributionsMetric
  const sort = (searchParams.get('sort') ?? 'orders') as DistributionsSortColumn
  const dir = (searchParams.get('dir') ?? 'desc') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? '20', 10) || 20))
  const search = searchParams.get('search') ?? undefined

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

  const validMetric: DistributionsMetric = metric === 'sales' ? 'sales' : 'cm1'
  const validSort = SORT_COLUMNS.includes(sort) ? sort : 'orders'

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

  try {
    const result = await computeDistributions(prisma, workspace as Parameters<typeof computeDistributions>[1], {
      from,
      to,
      metric: validMetric,
      search,
      sort: validSort,
      dir,
      page,
      pageSize,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[Distributions] computeDistributions failed', { slug, workspaceId: workspace.id, message, stack })
    return NextResponse.json(
      { error: 'Distributions computation failed', details: process.env.NODE_ENV === 'development' ? message : undefined },
      { status: 500 }
    )
  }
}
