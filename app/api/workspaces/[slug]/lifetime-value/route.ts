import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { computeLtv } from '@/lib/ltv/compute'
import type { LtvDimension, LtvMetric, LtvMode } from '@/lib/ltv/types'

const METRICS: LtvMetric[] = ['cm2', 'revenue', 'repeat_rate']
const MODES: LtvMode[] = ['cumulative', 'post_acq', 'incremental']
const DIMENSIONS: LtvDimension[] = [
  'product',
  'variant',
  'vendor',
  'collection',
  'product_type',
  'product_tags',
  'order_tags',
  'discount_codes',
  'discount_pct',
  'customer_id',
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
  const metric = (searchParams.get('metric') ?? 'cm2') as LtvMetric
  const mode = (searchParams.get('mode') ?? 'cumulative') as LtvMode
  const dimension = (searchParams.get('dimension') ?? 'product') as LtvDimension
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

  const validMetric = METRICS.includes(metric) ? metric : 'cm2'
  const validMode = MODES.includes(mode) ? mode : 'cumulative'
  const validDimension = DIMENSIONS.includes(dimension) ? dimension : 'product'

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

  const result = await computeLtv(prisma, workspace as Parameters<typeof computeLtv>[1], {
    from,
    to,
    metric: validMetric,
    mode: validMode,
    dimension: validDimension,
    page,
    pageSize,
    search,
  })

  return NextResponse.json(result)
}
