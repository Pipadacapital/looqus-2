import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

const SORT_FIELDS = ['title', 'productType', 'status', 'totalInventory', 'publishedAt', 'createdAt'] as const
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
  const sort = searchParams.get('sort') || 'title'
  const order = (searchParams.get('order') || 'asc') as 'asc' | 'desc'
  const search = (searchParams.get('search') || '').trim()
  const statusFilter = searchParams.get('status') || ''

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
    : 'title'
  const orderDir = ORDER_VALUES.includes(order) ? order : 'asc'

  const where: Prisma.ShopifyProductWhereInput = { connectionId }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { handle: { contains: search, mode: 'insensitive' } },
      { vendor: { contains: search, mode: 'insensitive' } },
      { productType: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (statusFilter) {
    where.status = statusFilter
  }

  const orderBy: Prisma.ShopifyProductOrderByWithRelationInput =
    sortField === 'title'
      ? { title: orderDir }
      : sortField === 'productType'
        ? { productType: orderDir }
        : sortField === 'status'
          ? { status: orderDir }
          : sortField === 'totalInventory'
            ? { totalInventory: orderDir }
            : sortField === 'publishedAt'
              ? { publishedAt: orderDir }
              : { createdAt: orderDir }

  const [products, total] = await Promise.all([
    prisma.shopifyProduct.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        handle: true,
        vendor: true,
        productType: true,
        status: true,
        imageUrl: true,
        totalInventory: true,
        publishedAt: true,
        createdAt: true,
      },
    }),
    prisma.shopifyProduct.count({ where }),
  ])

  const totalPages = Math.ceil(total / pageSize)

  return NextResponse.json({
    data: products.map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      vendor: p.vendor,
      productType: p.productType,
      status: p.status,
      imageUrl: p.imageUrl,
      totalInventory: p.totalInventory,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages,
  })
}
