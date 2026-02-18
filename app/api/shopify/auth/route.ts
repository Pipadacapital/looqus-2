import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import {
  normalizeShopDomain,
  validateShopDomain,
  generateNonce,
  buildAuthUrl,
} from '@/lib/shopify/oauth'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const shop = searchParams.get('shop')
  const workspaceSlug = searchParams.get('workspaceSlug')

  if (!shop || !workspaceSlug) {
    return NextResponse.json(
      { error: 'Missing required parameters: shop and workspaceSlug' },
      { status: 400 }
    )
  }

  // Verify the user is authenticated
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  // Normalize and validate the shop domain
  const shopDomain = normalizeShopDomain(shop)
  if (!validateShopDomain(shopDomain)) {
    return NextResponse.json(
      { error: 'Invalid Shopify store domain' },
      { status: 400 }
    )
  }

  // Generate a nonce for CSRF protection
  const nonce = generateNonce()

  // Store OAuth state in an HTTP-only cookie (expires in 10 minutes)
  const oauthState = JSON.stringify({
    nonce,
    workspaceSlug,
    userId: user.id,
    shopDomain,
  })

  const authUrl = buildAuthUrl(shopDomain, nonce)
  const response = NextResponse.redirect(authUrl)

  response.cookies.set('shopify_oauth_state', oauthState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  })

  return response
}
