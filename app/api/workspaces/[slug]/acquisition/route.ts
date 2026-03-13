import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { startOfYear, endOfDay, format } from 'date-fns'
import { computeAcquisition, computeAcquisitionTrend, computeAcquisitionComposition } from '@/lib/acquisition/compute'

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
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
      cogsSettings: true,
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

  const now = new Date()
  const defaultFrom = format(startOfYear(now), 'yyyy-MM-dd')
  const defaultTo = format(endOfDay(now), 'yyyy-MM-dd')
  const fromStr = fromParam ?? defaultFrom
  const toStr = toParam ?? defaultTo

  const fromDate = new Date(fromStr + 'T00:00:00.000Z')
  const toDate = new Date(toStr + 'T23:59:59.999Z')
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  const [result, trend, composition] = await Promise.all([
    computeAcquisition(prisma, workspace as any, { from: fromStr, to: toStr }),
    computeAcquisitionTrend(prisma, workspace as any, { from: fromStr, to: toStr }),
    computeAcquisitionComposition(prisma, workspace as any, { from: fromStr, to: toStr }),
  ])

  return NextResponse.json({
    summary: result.summary,
    daily: result.daily,
    currency: result.currency,
    trend,
    composition,
  })
}
