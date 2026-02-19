import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import {
  normalizeShopDomain,
  validateShopDomain,
  generateNonce,
  buildAuthUrl,
} from '@/lib/shopify/client'

/**
 * Saves the per-store Client ID + Secret as a PENDING connection,
 * then returns the Shopify OAuth authorization URL for the frontend
 * to redirect the user to.
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
    clientId: string
    clientSecret: string
    workspaceSlug: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, clientSecret, workspaceSlug } = body

  if (!body.shopDomain || !clientId || !clientSecret || !workspaceSlug) {
    return NextResponse.json(
      { error: 'Missing required fields: shopDomain, clientId, clientSecret, workspaceSlug' },
      { status: 400 }
    )
  }

  const shopDomain = normalizeShopDomain(body.shopDomain)

  if (!validateShopDomain(shopDomain)) {
    return NextResponse.json(
      { error: 'Invalid Shopify store domain' },
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

  // Save credentials as a PENDING connection so the callback can use them
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
      clientId,
      clientSecret,
      scopes: [],
      status: 'DISCONNECTED',
    },
    update: {
      clientId,
      clientSecret,
      status: 'DISCONNECTED',
    },
  })

  // Generate nonce and build OAuth URL
  const nonce = generateNonce()
  const authUrl = buildAuthUrl(shopDomain, clientId, nonce)

  // Build the state cookie so the callback can verify the request
  const oauthState = JSON.stringify({
    nonce,
    workspaceSlug,
    userId: user.id,
    shopDomain,
  })

  const response = NextResponse.json({ authUrl })

  response.cookies.set('shopify_oauth_state', oauthState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  return response
}
