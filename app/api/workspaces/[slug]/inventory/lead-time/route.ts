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

    if (!productShopifyId || typeof leadTimeDays !== 'number' || leadTimeDays < 0) {
        return NextResponse.json(
            { error: 'Invalid request: productShopifyId and leadTimeDays (>= 0) required' },
            { status: 400 }
        )
    }

    const workspace = await prisma.workspace.findUnique({
        where: { slug },
        select: { id: true },
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
