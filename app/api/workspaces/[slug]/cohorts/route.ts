import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { computeCohorts, getOrderDateStats } from '@/lib/cohorts/compute'
import type { CohortMetric, CohortMode } from '@/lib/cohorts/types'

const METRICS: CohortMetric[] = ['cm3', 'revenue', 'repeat', 'repurchase']
const MODES: CohortMode[] = ['post', 'cumulative', 'incr', 'pct', 'ltvcac']

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
  const metric = searchParams.get('metric') as CohortMetric | null
  const mode = searchParams.get('mode') as CohortMode | null

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

  const validMetric = metric && METRICS.includes(metric) ? metric : 'cm3'
  const validMode = mode && MODES.includes(mode) ? mode : 'post'

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
      meta_ads_connections: {
        select: {
          id: true,
          selected_ad_account_ids: true,
          selected_ad_account_id: true,
        },
      },
      google_ads_connections: {
        select: {
          id: true,
          selected_customer_ids: true,
          selected_customer_id: true,
        },
      },
      shiprocketConnection: {
        select: { id: true, status: true },
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

  const result = await computeCohorts(prisma, workspace as Parameters<typeof computeCohorts>[1], {
    from,
    to,
    metric: validMetric,
    mode: validMode,
  })

  const debugParam = request.nextUrl.searchParams.get('debug')
  if (debugParam === '1') {
    const connectionId = workspace.shopifyConnections[0]?.id
    if (connectionId) {
      const stats = await getOrderDateStats(prisma, connectionId, toDate)
      ;(result as { debug?: unknown }).debug = {
        ...stats,
        hint: 'If minProcessedAt > from, run POST /api/workspaces/[slug]/shopify/backfill-orders?daysBack=400',
      }
    }
  }

  return NextResponse.json(result)
}
