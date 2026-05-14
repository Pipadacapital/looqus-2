import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import {
  normalizeShopDomain,
  validateShopDomain,
  fetchShopInfo,
} from '@/lib/shopify/client'

/**
 * Connects a Shopify store using a per-store Admin API access token.
 * No OAuth redirect flow is required.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    shopDomain: string
    workspaceSlug: string
    accessToken: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { workspaceSlug } = body

  if (!body.shopDomain || !workspaceSlug || !body.accessToken) {
    return NextResponse.json(
      { error: 'Missing required fields: shopDomain, workspaceSlug, accessToken' },
      { status: 400 }
    )
  }

  const shopDomain = normalizeShopDomain(body.shopDomain)
  const accessToken = body.accessToken.trim()

  if (!validateShopDomain(shopDomain)) {
    return NextResponse.json(
      { error: 'Invalid Shopify store domain' },
      { status: 400 }
    )
  }
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Shopify Admin API access token is required' },
      { status: 400 }
    )
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true },
  })

  if (!workspace) {
    return NextResponse.json(
      { error: 'Workspace not found' },
      { status: 404 }
    )
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })

  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'You do not have permission to connect a store to this workspace' },
      { status: 403 }
    )
  }

  try {
    const shopInfo = await fetchShopInfo(shopDomain, accessToken)

    await prisma.shopifyConnection.upsert({
      where: {
        workspaceId_shopDomain: {
          workspaceId: workspace.id,
          shopDomain,
        },
      },
      create: {
        workspaceId: workspace.id,
        shopDomain,
        shopifyStoreId: shopInfo.id,
        accessToken,
        scopes: [],
        status: 'CONNECTED',
        installedAt: new Date(),
      },
      update: {
        shopifyStoreId: shopInfo.id,
        accessToken,
        status: 'CONNECTED',
        installedAt: new Date(),
      },
    })

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { storeUrl: shopDomain },
    })

    return NextResponse.json({
      ok: true,
      shopDomain,
      shopName: shopInfo.name,
    })
  } catch {
    return NextResponse.json(
      {
        error:
          'Could not verify Shopify token for this store. Check shop domain and Admin API access token.',
      },
      { status: 400 }
    )
  }
}
