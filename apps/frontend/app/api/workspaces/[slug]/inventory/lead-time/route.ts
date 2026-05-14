import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(
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
    const body = await request.json()
    const { productShopifyId, leadTimeDays } = body

    const WOO_LEAD_PREFIX = 'woo:p'

    if (
        typeof productShopifyId !== 'string' ||
        !productShopifyId ||
        typeof leadTimeDays !== 'number' ||
        leadTimeDays < 0
    ) {
        return NextResponse.json(
            { error: 'Invalid request: productShopifyId and leadTimeDays (>= 0) required' },
            { status: 400 }
        )
    }

    const workspace = await prisma.workspace.findUnique({
        where: { slug },
        select: { id: true, platform: true },
    })

    if (!workspace) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Only OWNER can edit lead time
    const membership = await prisma.workspaceMember.findUnique({
        where: {
            userId_workspaceId: {
                userId: user.id,
                workspaceId: workspace.id,
            },
        },
    })

    if (!membership || membership.role !== 'OWNER') {
        return NextResponse.json(
            { error: 'Only workspace owners can edit lead time' },
            { status: 403 }
        )
    }

    if (productShopifyId.startsWith(WOO_LEAD_PREFIX)) {
        if (workspace.platform !== 'WOOCOMMERCE') {
            return NextResponse.json(
                { error: 'Invalid lead time target for this workspace' },
                { status: 400 }
            )
        }
        const wcProductId = parseInt(productShopifyId.slice(WOO_LEAD_PREFIX.length), 10)
        if (!Number.isFinite(wcProductId)) {
            return NextResponse.json({ error: 'Invalid WooCommerce product id' }, { status: 400 })
        }
        const wooConn = await prisma.woocommerceConnection.findUnique({
            where: { workspaceId: workspace.id },
            select: { id: true },
        })
        if (!wooConn) {
            return NextResponse.json({ error: 'WooCommerce not connected' }, { status: 400 })
        }
        const exists = await prisma.woocommerceProduct.findFirst({
            where: { connectionId: wooConn.id, wcProductId },
            select: { id: true },
        })
        if (!exists) {
            return NextResponse.json({ error: 'Product not found' }, { status: 404 })
        }
    }

    const result = await prisma.productLeadTime.upsert({
        where: {
            workspaceId_productShopifyId: {
                workspaceId: workspace.id,
                productShopifyId,
            },
        },
        create: {
            workspaceId: workspace.id,
            productShopifyId,
            leadTimeDays: Math.round(leadTimeDays),
        },
        update: {
            leadTimeDays: Math.round(leadTimeDays),
        },
    })

    return NextResponse.json({ success: true, leadTimeDays: result.leadTimeDays })
}
