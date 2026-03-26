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
 * Accepts shopDomain + workspaceSlug, then returns the Shopify OAuth
 * authorization URL for the frontend to redirect the user to.
 * Credentials come from env (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET).
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
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { workspaceSlug } = body

  if (!body.shopDomain || !workspaceSlug) {
    return NextResponse.json(
      { error: 'Missing required fields: shopDomain, workspaceSlug' },
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

  const nonce = generateNonce()
  const authUrl = buildAuthUrl(shopDomain, nonce)

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
