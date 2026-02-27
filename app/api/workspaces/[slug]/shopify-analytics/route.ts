import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

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

  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return NextResponse.json({
      daily: [],
      summary: null,
      error: null,
    })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const defaultTo = today
  const defaultFrom = new Date(today)
  defaultFrom.setDate(defaultFrom.getDate() - 29)

  const fromDate = fromParam ? new Date(fromParam) : defaultFrom
  const toDate = toParam ? new Date(toParam) : defaultTo
  fromDate.setHours(0, 0, 0, 0)
  toDate.setHours(23, 59, 59, 999)

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range', daily: [], summary: null }, { status: 400 })
  }

  const daily = await prisma.shopifyAnalyticsDaily.findMany({
    where: {
      connectionId,
      date: { gte: fromDate, lte: toDate },
    },
    orderBy: { date: 'asc' },
    select: {
      date: true,
      netSales: true,
      ordersCount: true,
      aov: true,
      currency: true,
    },
  })

  const totalNetSales = daily.reduce((sum, d) => sum + Number(d.netSales), 0)
  const totalOrders = daily.reduce((sum, d) => sum + d.ordersCount, 0)
  const currency = daily[0]?.currency ?? 'USD'

  const summary = {
    totalNetSales,
    totalOrders,
    avgAov: totalOrders > 0 ? totalNetSales / totalOrders : 0,
    currency,
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
  }

  return NextResponse.json({
    daily: daily.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      netSales: Number(d.netSales),
      ordersCount: d.ordersCount,
      aov: Number(d.aov),
      currency: d.currency,
    })),
    summary,
    error: null,
  })
}
