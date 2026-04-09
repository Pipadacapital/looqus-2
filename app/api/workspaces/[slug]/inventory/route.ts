/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import {
  classifyInventoryStatus,
  computeDaysLeft,
  computeSellThrough,
} from '@/lib/inventory-constants'
import {
  getOrderInclusionRawFragment,
  normalizeOrderFilterSettings,
} from '@/lib/order-filters'
import {
  getUnicommerceProductMap,
  isUnicommerceActive,
} from '@/lib/unicommerce/product-resolver'

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
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20))
  const sort = searchParams.get('sort') || 'quantity'
  const dir = (searchParams.get('dir') || (sort === 'quantity' ? 'desc' : 'asc')).toLowerCase() === 'desc' ? 'desc' : 'asc'
  const search = (searchParams.get('search') || '').trim()
  const asOf = searchParams.get('asOf') || new Date().toISOString().slice(0, 10)
  const productId = searchParams.get('productId') || '' // variant drill-down
  const debug = searchParams.get('debug') === '1'

  // Validate workspace + membership
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
  const useUnicommerce = await isUnicommerceActive(workspace.id)

  if (useUnicommerce) {
    const ucMap = await getUnicommerceProductMap(workspace.id)
    const ucProducts = Array.from(ucMap.values())

    // Apply search filter
    const filtered = search
      ? ucProducts.filter((p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.skuCode.toLowerCase().includes(search.toLowerCase())
        )
      : ucProducts

    // Get sales velocity per SKU from Shopify line items
    // Find the Shopify connection for this workspace
    const shopifyConn = await prisma.shopifyConnection.findFirst({
      where: { workspaceId: workspace.id, status: 'CONNECTED' },
      select: { id: true },
    })

    // Build velocity map: skuCode → { l30, l90, l180, l360 }
    const velocityMap = new Map<
      string,
      { l30: number; l90: number; l180: number; l360: number }
    >()

    if (shopifyConn && filtered.length > 0) {
      const skuCodes = filtered.map((p) => p.skuCode)
      const now = new Date()
      const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      const d90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      const d180 = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
      const d360 = new Date(now.getTime() - 360 * 24 * 60 * 60 * 1000)

      // Single query for 360d, then slice by date
      const lineItems = await prisma.shopifyLineItem.findMany({
        where: {
          sku: { in: skuCodes },
          order: {
            connectionId: shopifyConn.id,
            processedAt: { gte: d360 },
          },
        },
        select: { sku: true, quantity: true, order: { select: { processedAt: true } } },
      })

      for (const li of lineItems) {
        if (!li.sku) continue
        const v = velocityMap.get(li.sku) ?? { l30: 0, l90: 0, l180: 0, l360: 0 }
        const date = li.order?.processedAt
        const qty = li.quantity ?? 0
        v.l360 += qty
        if (date && date >= d180) v.l180 += qty
        if (date && date >= d90) v.l90 += qty
        if (date && date >= d30) v.l30 += qty
        velocityMap.set(li.sku, v)
      }
    }

    // Map to exact InventoryRow shape
    const rows = filtered.map((p) => {
      const v = velocityMap.get(p.skuCode) ?? { l30: 0, l90: 0, l180: 0, l360: 0 }
      const qty = p.inventory ?? 0
      const dailyVelocity = v.l30 / 30
      const daysLeft = dailyVelocity > 0 ? Math.round(qty / dailyVelocity) : null

      const status =
        qty === 0 ? 'Out of stock' :
        daysLeft !== null && daysLeft < 21 ? 'Restock Soon' :
        daysLeft !== null && daysLeft > 180 ? 'Overstocked' :
        'Healthy'

      return {
        id: p.skuCode,
        shopifyId: null,
        title: p.name,
        brand: p.brand ?? '',
        skus: p.skuCode,
        status,
        quantity: qty,
        costValue: 0,
        price: p.mrp ?? null,
        compareAtPrice: null,
        sellThrough: 0,
        qtyL30: v.l30,
        qtyL90: v.l90,
        qtyL180: v.l180,
        qtyL360: v.l360,
        qtyN14ly: 0,
        daysLeft: daysLeft ?? 999999,
        leadTimeDays: 0,
        tags: '',
      }
    })

    // Sort by quantity desc by default (mirror Shopify default)
    rows.sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))

    const total = rows.length
    const totalPages = Math.ceil(total / pageSize)
    const paginated = rows.slice((page - 1) * pageSize, page * pageSize)

    return NextResponse.json({
      data: paginated,
      total,
      page,
      pageSize,
      totalPages,
    })
  }

  if (!connectionId) {
    return NextResponse.json({
      data: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
    })
  }

  const orderInclusionFragment = getOrderInclusionRawFragment(
    normalizeOrderFilterSettings(workspace),
    'o'
  )
  const orderInclusionFragmentO2 = getOrderInclusionRawFragment(
    normalizeOrderFilterSettings(workspace),
    'o2'
  )

  // ── Debug: prove order data availability (min/max dates, counts by window) ──
  if (debug) {
    const asOfEnd = new Date(asOf + 'T23:59:59.999Z')
    const start90 = new Date(asOf + 'T00:00:00.000Z')
    start90.setUTCDate(start90.getUTCDate() - 90)
    const start180 = new Date(asOf + 'T00:00:00.000Z')
    start180.setUTCDate(start180.getUTCDate() - 180)
    const start360 = new Date(asOf + 'T00:00:00.000Z')
    start360.setUTCDate(start360.getUTCDate() - 360)
    const [rangeRow, countsRow] = await Promise.all([
      prisma.$queryRaw<
        Array<{ min_processed_at: Date; max_processed_at: Date; order_count: bigint; line_item_count: bigint }>
      >`
        SELECT
          MIN(o.processed_at) as min_processed_at,
          MAX(o.processed_at) as max_processed_at,
          COUNT(DISTINCT o.id)::bigint as order_count,
          (SELECT COUNT(*)::bigint FROM shopify_line_items li WHERE li.order_id IN (SELECT id FROM shopify_orders o2 WHERE o2.connection_id = ${connectionId}::uuid AND o2.cancelled_at IS NULL ${orderInclusionFragmentO2})) as line_item_count
        FROM shopify_orders o
        WHERE o.connection_id = ${connectionId}::uuid
          AND o.cancelled_at IS NULL
          ${orderInclusionFragment}
      `,
      prisma.$queryRaw<
        Array<{
          orders_older_than_90: bigint
          orders_older_than_180: bigint
          orders_older_than_360: bigint
          line_items_90: bigint
          line_items_180: bigint
          line_items_360: bigint
        }>
      >`
        SELECT
          COUNT(*) FILTER (WHERE o.processed_at < ${start90})::bigint as orders_older_than_90,
          COUNT(*) FILTER (WHERE o.processed_at < ${start180})::bigint as orders_older_than_180,
          COUNT(*) FILTER (WHERE o.processed_at < ${start360})::bigint as orders_older_than_360,
          (SELECT COUNT(*)::bigint FROM shopify_line_items li JOIN shopify_orders o2 ON o2.id = li.order_id WHERE o2.connection_id = ${connectionId}::uuid AND o2.cancelled_at IS NULL ${orderInclusionFragmentO2} AND o2.processed_at < ${start90}) as line_items_90,
          (SELECT COUNT(*)::bigint FROM shopify_line_items li JOIN shopify_orders o2 ON o2.id = li.order_id WHERE o2.connection_id = ${connectionId}::uuid AND o2.cancelled_at IS NULL ${orderInclusionFragmentO2} AND o2.processed_at < ${start180}) as line_items_180,
          (SELECT COUNT(*)::bigint FROM shopify_line_items li JOIN shopify_orders o2 ON o2.id = li.order_id WHERE o2.connection_id = ${connectionId}::uuid AND o2.cancelled_at IS NULL ${orderInclusionFragmentO2} AND o2.processed_at < ${start360}) as line_items_360
        FROM shopify_orders o
        WHERE o.connection_id = ${connectionId}::uuid
          AND o.cancelled_at IS NULL
          ${orderInclusionFragment}
      `,
    ])
    const r = rangeRow[0]
    const c = countsRow[0]
    const debugPayload = {
      orderDateRange: {
        min_processed_at: r?.min_processed_at?.toISOString() ?? null,
        max_processed_at: r?.max_processed_at?.toISOString() ?? null,
        order_count: r?.order_count != null ? String(r.order_count) : '0',
        line_item_count: r?.line_item_count != null ? String(r.line_item_count) : '0',
      },
      asOf,
      countsRelativeToAsOf: {
        orders_older_than_90d: c?.orders_older_than_90 != null ? String(c.orders_older_than_90) : '0',
        orders_older_than_180d: c?.orders_older_than_180 != null ? String(c.orders_older_than_180) : '0',
        orders_older_than_360d: c?.orders_older_than_360 != null ? String(c.orders_older_than_360) : '0',
        line_items_in_orders_older_than_90d: c?.line_items_90 != null ? String(c.line_items_90) : '0',
        line_items_in_orders_older_than_180d: c?.line_items_180 != null ? String(c.line_items_180) : '0',
        line_items_in_orders_older_than_360d: c?.line_items_360 != null ? String(c.line_items_360) : '0',
      },
    }
    if (process.env.NODE_ENV === 'development') {
      console.log('[Inventory Debug]', JSON.stringify(debugPayload, null, 2))
    }
    return NextResponse.json({ debug: debugPayload })
  }

  // ── Date windows ──
  // Boundaries: [start, asOfDate] inclusive. We use processed_at (order processed date from Shopify).
  const asOfDate = new Date(asOf + 'T23:59:59.999Z')

  const l30Start = new Date(asOf + 'T00:00:00.000Z')
  l30Start.setUTCDate(l30Start.getUTCDate() - 30)

  const l90Start = new Date(asOf + 'T00:00:00.000Z')
  l90Start.setUTCDate(l90Start.getUTCDate() - 90)

  const l180Start = new Date(asOf + 'T00:00:00.000Z')
  l180Start.setUTCDate(l180Start.getUTCDate() - 180)

  const l360Start = new Date(asOf + 'T00:00:00.000Z')
  l360Start.setUTCDate(l360Start.getUTCDate() - 360)

  // N14LY: last year's +14d window
  const n14lyStart = new Date(asOf + 'T00:00:00.000Z')
  n14lyStart.setUTCFullYear(n14lyStart.getUTCFullYear() - 1)
  const n14lyEnd = new Date(n14lyStart.getTime())
  n14lyEnd.setUTCDate(n14lyEnd.getUTCDate() + 14)

  // Dev log to confirm distinct date windows
  if (process.env.NODE_ENV === 'development') {
    console.log('[Inventory] Date windows:', {
      asOf,
      l30Start: l30Start.toISOString(),
      l90Start: l90Start.toISOString(),
      l180Start: l180Start.toISOString(),
      l360Start: l360Start.toISOString(),
      n14lyStart: n14lyStart.toISOString(),
      n14lyEnd: n14lyEnd.toISOString(),
    })
  }

  // ── Variant view (drill-down by productId) ──
  if (productId) {
    return handleVariantView({
      productId,
      connectionId,
      workspaceId: workspace.id,
      page,
      pageSize,
      sort,
      dir,
      search,
      asOfDate,
      l30Start,
      l90Start,
      l180Start,
      l360Start,
      n14lyStart,
      n14lyEnd,
      orderInclusionFragment,
    })
  }

  // ── Product-level view ──
  const searchCondition = search
    ? Prisma.sql`AND (
        p.title ILIKE ${'%' + search + '%'}
        OR EXISTS (
          SELECT 1 FROM shopify_variants sv2
          WHERE sv2.product_id = p.id AND sv2.sku ILIKE ${'%' + search + '%'}
        )
      )`
    : Prisma.sql``

  // Count
  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT p.id) as count
    FROM shopify_products p
    WHERE p.connection_id = ${connectionId}::uuid
    ${searchCondition}
  `
  const total = Number(countResult[0]?.count ?? 0)
  const totalPages = Math.ceil(total / pageSize)

  if (total === 0) {
    return NextResponse.json({ data: [], total: 0, page, pageSize, totalPages: 0 })
  }

  // Sort mapping (status_order/days_left_raw/sell_through_raw from inv_metrics lateral)
  const sortMap: Record<string, string> = {
    title: 'p.title',
    vendor: 'p.vendor',
    quantity: 'p.total_inventory',
    status: 'inv_metrics.status_order',
    qtyL30: 'sales.qty_l30',
    qtyL90: 'sales.qty_l90',
    qtyL180: 'sales.qty_l180',
    qtyL360: 'sales.qty_l360',
    qtyN14ly: 'sales.qty_n14ly',
    compareAtPrice: 'vinfo.max_compare_at_price',
    price: 'vinfo.min_price',
    costValue: 'cost_val',
    sellThrough: 'inv_metrics.sell_through_raw',
    daysLeft: 'inv_metrics.days_left_raw',
  }
  const sortCol = sortMap[sort] || 'p.title'
  const orderByClause = Prisma.sql`ORDER BY ${Prisma.raw(sortCol)} ${dir === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`} NULLS LAST`

  // Main query — uses a single lateral join for sales + variant info subselects
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      shopify_id: string
      title: string
      vendor: string | null
      product_type: string | null
      total_inventory: number | null
      tags: string[]
      image_url: string | null
      coq: number | null
      skus: string | null
      max_compare_at_price: number | null
      min_price: number | null
      qty_l30: number
      qty_l90: number
      qty_l180: number
      qty_l360: number
      qty_n14ly: number
      lead_time_days: number | null
    }>
  >`
    SELECT
      p.id,
      p.shopify_id,
      p.title,
      p.vendor,
      p.product_type,
      p.total_inventory,
      p.tags,
      p.image_url,
      p.coq,
      -- Variant info
      vinfo.skus,
      vinfo.max_compare_at_price,
      vinfo.min_price,
      -- Sales (single scan with CASE WHEN for distinct windows)
      sales.qty_l30,
      sales.qty_l90,
      sales.qty_l180,
      sales.qty_l360,
      sales.qty_n14ly,
      -- Lead time
      plt.lead_time_days
    FROM shopify_products p
    -- Variant aggregations
    LEFT JOIN LATERAL (
      SELECT
        (SELECT STRING_AGG(DISTINCT sv2.sku, ', ' ORDER BY sv2.sku) FROM shopify_variants sv2 WHERE sv2.product_id = p.id AND sv2.sku IS NOT NULL AND sv2.sku != '') as skus,
        MAX(sv.compare_at_price)::numeric as max_compare_at_price,
        MIN(sv.price)::numeric as min_price
      FROM shopify_variants sv
      WHERE sv.product_id = p.id
    ) vinfo ON true
    -- Sales aggregation with single scan, CASE WHEN for each window
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(CASE WHEN o.processed_at >= ${l30Start} THEN li.quantity ELSE 0 END), 0)::int as qty_l30,
        COALESCE(SUM(CASE WHEN o.processed_at >= ${l90Start} THEN li.quantity ELSE 0 END), 0)::int as qty_l90,
        COALESCE(SUM(CASE WHEN o.processed_at >= ${l180Start} THEN li.quantity ELSE 0 END), 0)::int as qty_l180,
        COALESCE(SUM(li.quantity), 0)::int as qty_l360,
        COALESCE(SUM(CASE WHEN o.processed_at >= ${n14lyStart} AND o.processed_at <= ${n14lyEnd} THEN li.quantity ELSE 0 END), 0)::int as qty_n14ly
      FROM shopify_line_items li
      JOIN shopify_orders o ON o.id = li.order_id
      WHERE li.product_shopify_id = p.shopify_id
        AND li.connection_id = ${connectionId}::uuid
        AND o.processed_at >= ${l360Start}
        AND o.processed_at <= ${asOfDate}
        AND o.cancelled_at IS NULL
        ${orderInclusionFragment}
    ) sales ON true
    LEFT JOIN LATERAL (
      SELECT
        (CASE
          WHEN p.total_inventory IS NULL OR p.total_inventory <= 0 THEN 0
          WHEN sales.qty_l30 > 0 THEN (ROUND((p.total_inventory::numeric) / (sales.qty_l30::numeric / 30.0)))::int
          WHEN sales.qty_l90 > 0 THEN (ROUND((p.total_inventory::numeric) / (sales.qty_l90::numeric / 90.0)))::int
          WHEN sales.qty_l180 > 0 THEN (ROUND((p.total_inventory::numeric) / (sales.qty_l180::numeric / 180.0)))::int
          WHEN sales.qty_l360 > 0 THEN (ROUND((p.total_inventory::numeric) / (sales.qty_l360::numeric / 360.0)))::int
          ELSE 999999
        END) as days_left_raw,
        (CASE
          WHEN p.total_inventory IS NULL OR p.total_inventory <= 0 THEN 0
          WHEN (CASE
            WHEN p.total_inventory IS NULL OR p.total_inventory <= 0 THEN 0
            WHEN sales.qty_l30 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l30::numeric / 30.0)
            WHEN sales.qty_l90 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l90::numeric / 90.0)
            WHEN sales.qty_l180 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l180::numeric / 180.0)
            WHEN sales.qty_l360 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l360::numeric / 360.0)
            ELSE 999999
          END) < 21 THEN 1
          WHEN (CASE
            WHEN p.total_inventory IS NULL OR p.total_inventory <= 0 THEN 0
            WHEN sales.qty_l30 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l30::numeric / 30.0)
            WHEN sales.qty_l90 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l90::numeric / 90.0)
            WHEN sales.qty_l180 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l180::numeric / 180.0)
            WHEN sales.qty_l360 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l360::numeric / 360.0)
            ELSE 999999
          END) >= 365 THEN 4
          WHEN (CASE
            WHEN p.total_inventory IS NULL OR p.total_inventory <= 0 THEN 0
            WHEN sales.qty_l30 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l30::numeric / 30.0)
            WHEN sales.qty_l90 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l90::numeric / 90.0)
            WHEN sales.qty_l180 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l180::numeric / 180.0)
            WHEN sales.qty_l360 > 0 THEN (p.total_inventory::numeric) / (sales.qty_l360::numeric / 360.0)
            ELSE 999999
          END) >= 180 THEN 3
          ELSE 2
        END) as status_order,
        (CASE
          WHEN (COALESCE(sales.qty_l360, 0) + COALESCE(p.total_inventory, 0)) <= 0 THEN 0
          ELSE ROUND((COALESCE(sales.qty_l360, 0)::numeric / (COALESCE(sales.qty_l360, 0) + COALESCE(p.total_inventory, 0))) * 1000) / 10.0
        END) as sell_through_raw
    ) inv_metrics ON true
    LEFT JOIN product_lead_times plt
      ON plt.workspace_id = ${workspace.id}::uuid
      AND plt.product_shopify_id = p.shopify_id
    WHERE p.connection_id = ${connectionId}::uuid
    ${searchCondition}
    ${orderByClause}
    LIMIT ${pageSize}
    OFFSET ${(page - 1) * pageSize}
  `

  // Dev log first row for verification
  if (process.env.NODE_ENV === 'development' && rows.length > 0) {
    const r = rows[0]
    console.log('[Inventory] First row sales:', {
      title: r.title,
      qty_l30: r.qty_l30,
      qty_l90: r.qty_l90,
      qty_l180: r.qty_l180,
      qty_l360: r.qty_l360,
      qty_n14ly: r.qty_n14ly,
    })
  }

  const data = rows.map((r) => {
    const currentInventory = r.total_inventory ?? 0
    const qtyL30 = Number(r.qty_l30) || 0
    const qtyL90 = Number(r.qty_l90) || 0
    const qtyL180 = Number(r.qty_l180) || 0
    const salesL360 = Number(r.qty_l360) || 0
    const daysLeft = computeDaysLeft(currentInventory, qtyL30, qtyL90, qtyL180, salesL360)
    const inventoryStatus = classifyInventoryStatus(currentInventory, daysLeft)
    const coqPerUnit = r.coq != null ? Number(r.coq) : 0
    const costValue = coqPerUnit * currentInventory
    const sellThrough = computeSellThrough(currentInventory, salesL360)

    return {
      id: r.id,
      shopifyId: r.shopify_id,
      title: r.title,
      brand: r.vendor || r.product_type || '—',
      skus: r.skus || '—',
      status: inventoryStatus,
      quantity: currentInventory,
      costValue,
      price: r.min_price != null ? Number(r.min_price) : null,
      compareAtPrice: r.max_compare_at_price != null ? Number(r.max_compare_at_price) : null,
      sellThrough,
      qtyL30: Number(r.qty_l30) || 0,
      qtyL90: Number(r.qty_l90) || 0,
      qtyL180: Number(r.qty_l180) || 0,
      qtyL360: salesL360,
      qtyN14ly: Number(r.qty_n14ly) || 0,
      daysLeft,
      leadTimeDays: r.lead_time_days ?? 0,
      tags: (r.tags ?? []).join(', ') || '—',
    }
  })

  return NextResponse.json({ data, total, page, pageSize, totalPages })
}

// ────────────────────── Variant-level view ──────────────────────

async function handleVariantView(opts: {
  productId: string
  connectionId: string
  workspaceId: string
  page: number
  pageSize: number
  sort: string
  dir: string
  search: string
  asOfDate: Date
  l30Start: Date
  l90Start: Date
  l180Start: Date
  l360Start: Date
  n14lyStart: Date
  n14lyEnd: Date
  orderInclusionFragment: Prisma.Sql
}) {
  const {
    productId, connectionId, workspaceId,
    page, pageSize, sort, dir, search,
    asOfDate, l30Start, l90Start, l180Start, l360Start, n14lyStart, n14lyEnd,
    orderInclusionFragment,
  } = opts

  // Fetch the parent product
  const product = await prisma.shopifyProduct.findUnique({
    where: { id: productId },
    select: { id: true, shopifyId: true, title: true, coq: true, vendor: true, productType: true, tags: true },
  })

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  // Dev log for variant diagnosis
  if (process.env.NODE_ENV === 'development') {
    const [{ cnt }] = await prisma.$queryRaw<[{ cnt: number }]>`
      SELECT COUNT(*)::int as cnt FROM shopify_variants WHERE product_id = ${productId}::uuid
    `
    console.log('[Inventory] Variant view:', {
      productId,
      shopifyId: product.shopifyId,
      title: product.title,
      variantCount: cnt,
    })
  }

  const searchCondition = search
    ? Prisma.sql`AND (sv.title ILIKE ${'%' + search + '%'} OR sv.sku ILIKE ${'%' + search + '%'})`
    : Prisma.sql``

  // Count variants
  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count
    FROM shopify_variants sv
    WHERE sv.product_id = ${productId}::uuid
    ${searchCondition}
  `
  const total = Number(countResult[0]?.count ?? 0)
  const totalPages = Math.ceil(total / pageSize)

  if (total === 0) {
    return NextResponse.json({
      data: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
      productTitle: product.title,
    })
  }

  // Sort mapping for variants (status/daysLeft/sellThrough from inv_metrics lateral)
  const sortMap: Record<string, string> = {
    title: 'sv.title',
    sku: 'sv.sku',
    quantity: 'sv.inventory_quantity',
    status: 'inv_metrics.status_order',
    price: 'sv.price',
    compareAtPrice: 'sv.compare_at_price',
    qtyL30: 'sales.qty_l30',
    qtyL90: 'sales.qty_l90',
    qtyL180: 'sales.qty_l180',
    qtyL360: 'sales.qty_l360',
    qtyN14ly: 'sales.qty_n14ly',
    daysLeft: 'inv_metrics.days_left_raw',
    sellThrough: 'inv_metrics.sell_through_raw',
  }
  const sortCol = sortMap[sort] || 'sv.title'
  const orderByClause = Prisma.sql`ORDER BY ${Prisma.raw(sortCol)} ${dir === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`} NULLS LAST`

  // Query variants with sales by SKU matching
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      shopify_id: string
      title: string | null
      sku: string | null
      price: number | null
      compare_at_price: number | null
      inventory_quantity: number | null
      qty_l30: number
      qty_l90: number
      qty_l180: number
      qty_l360: number
      qty_n14ly: number
    }>
  >`
    SELECT
      sv.id,
      sv.shopify_id,
      sv.title,
      sv.sku,
      sv.price::numeric,
      sv.compare_at_price::numeric,
      sv.inventory_quantity,
      -- Sales by SKU matching
      COALESCE(sales.qty_l30, 0)::int as qty_l30,
      COALESCE(sales.qty_l90, 0)::int as qty_l90,
      COALESCE(sales.qty_l180, 0)::int as qty_l180,
      COALESCE(sales.qty_l360, 0)::int as qty_l360,
      COALESCE(sales.qty_n14ly, 0)::int as qty_n14ly
    FROM shopify_variants sv
    LEFT JOIN LATERAL (
      SELECT
        SUM(CASE WHEN o.processed_at >= ${l30Start} THEN li.quantity ELSE 0 END)::int as qty_l30,
        SUM(CASE WHEN o.processed_at >= ${l90Start} THEN li.quantity ELSE 0 END)::int as qty_l90,
        SUM(CASE WHEN o.processed_at >= ${l180Start} THEN li.quantity ELSE 0 END)::int as qty_l180,
        SUM(li.quantity)::int as qty_l360,
        SUM(CASE WHEN o.processed_at >= ${n14lyStart} AND o.processed_at <= ${n14lyEnd} THEN li.quantity ELSE 0 END)::int as qty_n14ly
      FROM shopify_line_items li
      JOIN shopify_orders o ON o.id = li.order_id
      WHERE li.sku = sv.sku
        AND li.sku IS NOT NULL AND li.sku != ''
        AND li.connection_id = ${connectionId}::uuid
        AND o.processed_at >= ${l360Start}
        AND o.processed_at <= ${asOfDate}
        AND o.cancelled_at IS NULL
        ${orderInclusionFragment}
    ) sales ON true
    LEFT JOIN LATERAL (
      SELECT
        (CASE
          WHEN sv.inventory_quantity IS NULL OR sv.inventory_quantity <= 0 THEN 0
          WHEN sales.qty_l30 > 0 THEN (ROUND((sv.inventory_quantity::numeric) / (sales.qty_l30::numeric / 30.0)))::int
          WHEN sales.qty_l90 > 0 THEN (ROUND((sv.inventory_quantity::numeric) / (sales.qty_l90::numeric / 90.0)))::int
          WHEN sales.qty_l180 > 0 THEN (ROUND((sv.inventory_quantity::numeric) / (sales.qty_l180::numeric / 180.0)))::int
          WHEN sales.qty_l360 > 0 THEN (ROUND((sv.inventory_quantity::numeric) / (sales.qty_l360::numeric / 360.0)))::int
          ELSE 999999
        END) as days_left_raw,
        (CASE
          WHEN sv.inventory_quantity IS NULL OR sv.inventory_quantity <= 0 THEN 0
          WHEN (CASE
            WHEN sv.inventory_quantity IS NULL OR sv.inventory_quantity <= 0 THEN 0
            WHEN sales.qty_l30 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l30::numeric / 30.0)
            WHEN sales.qty_l90 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l90::numeric / 90.0)
            WHEN sales.qty_l180 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l180::numeric / 180.0)
            WHEN sales.qty_l360 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l360::numeric / 360.0)
            ELSE 999999
          END) < 21 THEN 1
          WHEN (CASE
            WHEN sv.inventory_quantity IS NULL OR sv.inventory_quantity <= 0 THEN 0
            WHEN sales.qty_l30 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l30::numeric / 30.0)
            WHEN sales.qty_l90 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l90::numeric / 90.0)
            WHEN sales.qty_l180 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l180::numeric / 180.0)
            WHEN sales.qty_l360 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l360::numeric / 360.0)
            ELSE 999999
          END) >= 365 THEN 4
          WHEN (CASE
            WHEN sv.inventory_quantity IS NULL OR sv.inventory_quantity <= 0 THEN 0
            WHEN sales.qty_l30 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l30::numeric / 30.0)
            WHEN sales.qty_l90 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l90::numeric / 90.0)
            WHEN sales.qty_l180 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l180::numeric / 180.0)
            WHEN sales.qty_l360 > 0 THEN (sv.inventory_quantity::numeric) / (sales.qty_l360::numeric / 360.0)
            ELSE 999999
          END) >= 180 THEN 3
          ELSE 2
        END) as status_order,
        (CASE
          WHEN (COALESCE(sales.qty_l360, 0) + COALESCE(sv.inventory_quantity, 0)) <= 0 THEN 0
          ELSE ROUND((COALESCE(sales.qty_l360, 0)::numeric / (COALESCE(sales.qty_l360, 0) + COALESCE(sv.inventory_quantity, 0))) * 1000) / 10.0
        END) as sell_through_raw
    ) inv_metrics ON true
    WHERE sv.product_id = ${productId}::uuid
    ${searchCondition}
    ${orderByClause}
    LIMIT ${pageSize}
    OFFSET ${(page - 1) * pageSize}
  `

  // Lead time is per-product
  const leadTimeRecord = await prisma.productLeadTime.findUnique({
    where: {
      workspaceId_productShopifyId: {
        workspaceId,
        productShopifyId: product.shopifyId,
      },
    },
  })
  const leadTimeDays = leadTimeRecord?.leadTimeDays ?? 0
  const coqPerUnit = product.coq != null ? Number(product.coq) : 0

  const data = rows.map((r) => {
    const currentInventory = r.inventory_quantity ?? 0
    const qtyL30 = Number(r.qty_l30) || 0
    const qtyL90 = Number(r.qty_l90) || 0
    const qtyL180 = Number(r.qty_l180) || 0
    const salesL360 = Number(r.qty_l360) || 0
    const daysLeft = computeDaysLeft(currentInventory, qtyL30, qtyL90, qtyL180, salesL360)
    const inventoryStatus = classifyInventoryStatus(currentInventory, daysLeft)
    const sellThrough = computeSellThrough(currentInventory, salesL360)
    const costValue = coqPerUnit * currentInventory

    return {
      id: r.id,
      shopifyId: r.shopify_id,
      title: r.title || 'Default',
      brand: product.vendor || product.productType || '—',
      skus: r.sku || '—',
      status: inventoryStatus,
      quantity: currentInventory,
      costValue,
      price: r.price != null ? Number(r.price) : null,
      compareAtPrice: r.compare_at_price != null ? Number(r.compare_at_price) : null,
      sellThrough,
      qtyL30,
      qtyL90,
      qtyL180,
      qtyL360: salesL360,
      qtyN14ly: Number(r.qty_n14ly) || 0,
      daysLeft,
      leadTimeDays,
      tags: (product.tags ?? []).join(', ') || '—',
    }
  })

  return NextResponse.json({
    data,
    total,
    page,
    pageSize,
    totalPages,
    productTitle: product.title,
  })
}
