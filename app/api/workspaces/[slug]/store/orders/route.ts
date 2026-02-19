import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

const SORT_FIELDS = ['processedAt', 'totalPrice', 'name', 'financialStatus'] as const
const ORDER_VALUES = ['asc', 'desc'] as const

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
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get('pageSize')) || 10))
  const sort = searchParams.get('sort') || 'processedAt'
  const order = (searchParams.get('order') || 'desc') as 'asc' | 'desc'
  const search = (searchParams.get('search') || '').trim()
  const financialStatus = searchParams.get('financialStatus') || ''
  const fulfillmentStatus = searchParams.get('fulfillmentStatus') || ''

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
      data: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
    })
  }

  const sortField = SORT_FIELDS.includes(sort as (typeof SORT_FIELDS)[number])
    ? sort
    : 'processedAt'
  const orderDir = ORDER_VALUES.includes(order) ? order : 'desc'

  const where: Prisma.ShopifyOrderWhereInput = { connectionId }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { orderNumber: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (financialStatus) {
    where.financialStatus = financialStatus
  }
  if (fulfillmentStatus) {
    where.fulfillmentStatus = fulfillmentStatus
  }

  const orderBy: Prisma.ShopifyOrderOrderByWithRelationInput =
    sortField === 'name'
      ? { name: orderDir }
      : sortField === 'totalPrice'
        ? { totalPrice: orderDir }
        : sortField === 'financialStatus'
          ? { financialStatus: orderDir }
          : { processedAt: orderDir }

  const [orders, total] = await Promise.all([
    prisma.shopifyOrder.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        orderNumber: true,
        name: true,
        email: true,
        totalPrice: true,
        currency: true,
        financialStatus: true,
        fulfillmentStatus: true,
        processedAt: true,
        cancelledAt: true,
      },
    }),
    prisma.shopifyOrder.count({ where }),
  ])

  const totalPages = Math.ceil(total / pageSize)

  return NextResponse.json({
    data: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      name: o.name,
      email: o.email,
      totalPrice: String(o.totalPrice),
      currency: o.currency,
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      processedAt: o.processedAt.toISOString(),
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
    })),
    total,
    page,
    pageSize,
    totalPages,
  })
}
