import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

const SORT_FIELDS = ['title', 'productType', 'status', 'totalInventory', 'publishedAt', 'createdAt', 'coq'] as const
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
  const coqFilter = searchParams.get('coqFilter') || ''

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

  const sortField = SORT_FIELDS.includes(sort as (typeof SORT_FIELDS)[number]) ? sort : 'title'
  const orderDir = ORDER_VALUES.includes(order) ? order : 'asc'

  if (isWoocommerce) {
    const where: Prisma.WoocommerceProductWhereInput = { connectionId }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (statusFilter) {
      where.status = statusFilter
    }
    if (coqFilter === 'set') {
      where.coq = { not: null }
    } else if (coqFilter === 'not_set') {
      where.coq = null
    }

    const orderBy: Prisma.WoocommerceProductOrderByWithRelationInput =
      sortField === 'title'
        ? { name: orderDir }
        : sortField === 'status'
          ? { status: orderDir }
          : sortField === 'totalInventory'
            ? { stockQuantity: orderDir }
            : { wcProductId: orderDir }

    const [products, total] = await Promise.all([
      prisma.woocommerceProduct.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          wcProductId: true,
          name: true,
          slug: true,
          sku: true,
          status: true,
          stockQuantity: true,
          coq: true,
          categories: true,
          images: true,
          rawJson: true,
          syncedAt: true,
        },
      }),
      prisma.woocommerceProduct.count({ where }),
    ])

    return NextResponse.json({
      data: products.map((p) => {
        const images = Array.isArray(p.images) ? p.images : []
        const firstImage = images[0] as { src?: string } | undefined
        const categories = Array.isArray(p.categories) ? p.categories : []
        const categoryNames = categories
          .map((category) =>
            typeof category === 'object' && category !== null && 'name' in category
              ? String((category as { name?: unknown }).name ?? '')
              : ''
          )
          .filter((name) => name.length > 0)
        const raw = (p.rawJson && typeof p.rawJson === 'object'
          ? (p.rawJson as Record<string, unknown>)
          : null)
        const publishedAtRaw =
          (typeof raw?.date_created_gmt === 'string' && raw.date_created_gmt) ||
          (typeof raw?.date_created === 'string' && raw.date_created) ||
          (typeof raw?.date_modified_gmt === 'string' && raw.date_modified_gmt) ||
          (typeof raw?.date_modified === 'string' && raw.date_modified) ||
          null
        const attributes = Array.isArray(raw?.attributes) ? raw.attributes : []
        const vendorFromAttributes = attributes.find((attribute) => {
          if (typeof attribute !== 'object' || attribute == null) return false
          const name = (attribute as { name?: unknown }).name
          return (
            typeof name === 'string' &&
            (name.toLowerCase() === 'brand' || name.toLowerCase() === 'vendor')
          )
        }) as { options?: unknown } | undefined
        const vendorOptions = Array.isArray(vendorFromAttributes?.options)
          ? vendorFromAttributes?.options
          : []
        const vendor =
          vendorOptions.length > 0
            ? String(vendorOptions[0])
            : typeof raw?.brand === 'string'
              ? raw.brand
              : null

        return {
          id: p.id,
          title: p.name ?? `Product #${p.wcProductId}`,
          handle: p.slug ?? p.sku ?? String(p.wcProductId),
          vendor,
          productType:
            categoryNames.length > 0 ? categoryNames.join(', ') : null,
          status: (p.status ?? 'draft').toUpperCase(),
          imageUrl: firstImage?.src ?? null,
          totalInventory: p.stockQuantity,
          publishedAt: publishedAtRaw,
          coq: p.coq != null ? Number(p.coq) : null,
          createdAt: p.syncedAt.toISOString(),
        }
      }),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  }

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
  if (coqFilter === 'set') {
    where.coq = { not: null }
  } else if (coqFilter === 'not_set') {
    where.coq = null
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
              : sortField === 'coq'
                ? { coq: orderDir }
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
        coq: true,
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
      coq: p.coq != null ? Number(p.coq) : null,
      createdAt: p.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages,
  })
}
