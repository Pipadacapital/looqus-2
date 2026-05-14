import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug, id: productId } = await context.params

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      platform: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
      },
      woocommerceConnection: {
        select: {
          id: true,
          status: true,
        },
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

  const body = await request.json().catch(() => ({}))
  const coq = body.coq

  if (coq !== undefined && coq !== null) {
    const num = Number(coq)
    if (Number.isNaN(num) || num < 0) {
      return NextResponse.json(
        { error: 'coq must be a non-negative number' },
        { status: 400 }
      )
    }
  }

  const normalizedCoq =
    coq === undefined || coq === null || coq === '' ? null : Number(coq)

  if (workspace.platform === 'WOOCOMMERCE') {
    const connectionId =
      workspace.woocommerceConnection?.status === 'CONNECTED'
        ? workspace.woocommerceConnection.id
        : null

    if (!connectionId) {
      return NextResponse.json({ error: 'WooCommerce connection not found' }, { status: 404 })
    }

    const product = await prisma.woocommerceProduct.findFirst({
      where: {
        id: productId,
        connectionId,
      },
      select: { id: true },
    })

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const updated = await prisma.woocommerceProduct.update({
      where: { id: productId },
      data: { coq: normalizedCoq },
      select: {
        id: true,
        coq: true,
      },
    })

    return NextResponse.json({
      id: updated.id,
      coq: updated.coq != null ? Number(updated.coq) : null,
    })
  }

  const connectionIds = workspace.shopifyConnections.map((c) => c.id)
  const product = await prisma.shopifyProduct.findFirst({
    where: {
      id: productId,
      connectionId: { in: connectionIds },
    },
    select: { id: true },
  })

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const updated = await prisma.shopifyProduct.update({
    where: { id: productId },
    data: {
      coq: normalizedCoq,
    },
    select: {
      id: true,
      coq: true,
    },
  })

  return NextResponse.json({
    id: updated.id,
    coq: updated.coq != null ? Number(updated.coq) : null,
  })
}
