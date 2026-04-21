import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

const SORT_FIELDS = ['firstName', 'email', 'ordersCount', 'totalSpent', 'shopifyCreatedAt'] as const
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
  const sort = searchParams.get('sort') || 'firstName'
  const order = (searchParams.get('order') || 'asc') as 'asc' | 'desc'
  const search = (searchParams.get('search') || '').trim()

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      platform: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
      woocommerceConnection: {
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

  const isWoocommerce = workspace.platform === 'WOOCOMMERCE'
  const connectionId = isWoocommerce
    ? workspace.woocommerceConnection?.status === 'CONNECTED'
      ? workspace.woocommerceConnection.id
      : null
    : workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return NextResponse.json({
      data: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
    })
  }

  const sortField = SORT_FIELDS.includes(sort as (typeof SORT_FIELDS)[number]) ? sort : 'firstName'
  const orderDir = ORDER_VALUES.includes(order) ? order : 'asc'

  if (isWoocommerce) {
    const orders = await prisma.woocommerceOrder.findMany({
      where: {
        connectionId,
        ...(search
          ? {
              OR: [
                { customerEmail: { contains: search, mode: 'insensitive' } },
                { customerPhone: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        customerEmail: true,
        total: true,
        currency: true,
        dateCreated: true,
      },
    })

    const grouped = new Map<
      string,
      {
        email: string | null
        ordersCount: number
        totalSpent: number
        currency: string | null
        createdAt: Date | null
      }
    >()

    for (const order of orders) {
      const key = order.customerEmail?.toLowerCase() ?? '__unknown__'
      const current =
        grouped.get(key) ??
        {
          email: order.customerEmail ?? null,
          ordersCount: 0,
          totalSpent: 0,
          currency: order.currency ?? null,
          createdAt: order.dateCreated ?? null,
        }
      current.ordersCount += 1
      current.totalSpent += Number(order.total ?? 0)
      if (!current.createdAt || (order.dateCreated && order.dateCreated < current.createdAt)) {
        current.createdAt = order.dateCreated
      }
      grouped.set(key, current)
    }

    const rows = Array.from(grouped.entries()).map(([key, value]) => ({
      id: `wc-${key}`,
      email: value.email,
      firstName: null,
      lastName: null,
      ordersCount: value.ordersCount,
      totalSpent: value.totalSpent,
      currency: value.currency,
      state: null,
      shopifyCreatedAt: value.createdAt?.toISOString() ?? null,
      createdAt: value.createdAt?.toISOString() ?? new Date(0).toISOString(),
    }))

    const direction = orderDir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      if (sortField === 'email' || sortField === 'firstName') {
        return (a.email ?? '').localeCompare(b.email ?? '') * direction
      }
      if (sortField === 'ordersCount') {
        return (a.ordersCount - b.ordersCount) * direction
      }
      if (sortField === 'totalSpent') {
        return (a.totalSpent - b.totalSpent) * direction
      }
      return (
        (new Date(a.shopifyCreatedAt ?? 0).getTime() -
          new Date(b.shopifyCreatedAt ?? 0).getTime()) * direction
      )
    })

    const total = rows.length
    const paged = rows.slice((page - 1) * pageSize, page * pageSize)

    return NextResponse.json({
      data: paged.map((c) => ({
        ...c,
        totalSpent: String(c.totalSpent),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  }

  const where: Prisma.ShopifyCustomerWhereInput = { connectionId }

  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
    ]
  }

  const orderBy: Prisma.ShopifyCustomerOrderByWithRelationInput =
    sortField === 'firstName'
      ? { firstName: orderDir }
      : sortField === 'email'
        ? { email: orderDir }
        : sortField === 'ordersCount'
          ? { ordersCount: orderDir }
          : sortField === 'totalSpent'
            ? { totalSpent: orderDir }
            : { shopifyCreatedAt: orderDir }

  const [customers, total] = await Promise.all([
    prisma.shopifyCustomer.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        ordersCount: true,
        totalSpent: true,
        currency: true,
        state: true,
        shopifyCreatedAt: true,
        createdAt: true,
      },
    }),
    prisma.shopifyCustomer.count({ where }),
  ])

  const totalPages = Math.ceil(total / pageSize)

  return NextResponse.json({
    data: customers.map((c) => ({
      id: c.id,
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      ordersCount: c.ordersCount,
      totalSpent: String(c.totalSpent),
      currency: c.currency,
      state: c.state,
      shopifyCreatedAt: c.shopifyCreatedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages,
  })
}
