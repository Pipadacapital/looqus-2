import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { extractWoocommerceOrderType } from '@/lib/order-filters'
import { fetchWoocommerceOrders } from '@/lib/integrations/woocommerce'

/**
 * GET: Return distinct Shopify order tags for the workspace's orders (for Filters multiselect).
 * Sorted alphabetically, no duplicates.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      members: { where: { userId: user.id } },
      woocommerceConnection: {
        select: {
          id: true,
          status: true,
          storeUrl: true,
          consumerKey: true,
          consumerSecret: true,
        },
      },
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!workspace || workspace.members.length === 0) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  if (workspace.platform === 'WOOCOMMERCE') {
    const wooConnection =
      workspace.woocommerceConnection?.status === 'CONNECTED'
        ? workspace.woocommerceConnection
        : null

    if (!wooConnection) {
      return NextResponse.json({ tags: [] })
    }

    const types = new Set<string>()

    // Prefer fresh Woo API payloads so newly added order_type tags show immediately.
    try {
      const recentAfter = new Date()
      recentAfter.setUTCDate(recentAfter.getUTCDate() - 120)
      let page = 1
      let totalPages = 1
      do {
        const result = await fetchWoocommerceOrders(
          wooConnection.storeUrl,
          wooConnection.consumerKey,
          wooConnection.consumerSecret,
          recentAfter,
          page
        )
        totalPages = result.totalPages
        for (const order of result.orders) {
          const value = extractWoocommerceOrderType(order)
          if (value) types.add(value)
        }
        page += 1
      } while (page <= totalPages && page <= 5)
    } catch {
      // Fallback to synced DB payload when API request fails.
    }

    if (types.size === 0) {
      const orders = await prisma.woocommerceOrder.findMany({
        where: { connectionId: wooConnection.id },
        select: { rawJson: true },
        take: 5000,
      })
      for (const order of orders) {
        const value = extractWoocommerceOrderType(order.rawJson)
        if (value) types.add(value)
      }
    }

    return NextResponse.json({ tags: [...types].sort((a, b) => a.localeCompare(b)) })
  }

  const connectionId = workspace.shopifyConnections[0]?.id
  if (!connectionId) {
    return NextResponse.json({ tags: [] })
  }

  const rows = await prisma.$queryRaw<{ tag: string }[]>`
    SELECT DISTINCT unnest(tags) AS tag
    FROM shopify_orders
    WHERE connection_id = ${connectionId}::uuid
      AND array_length(tags, 1) > 0
    ORDER BY tag
  `
  const tags = rows.map((r) => r.tag).filter(Boolean)
  return NextResponse.json({ tags })
}
