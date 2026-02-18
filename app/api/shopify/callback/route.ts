import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  validateHmac,
  validateShopDomain,
  exchangeCodeForToken,
  fetchShopInfo,
} from '@/lib/shopify/oauth'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const shop = searchParams.get('shop')
  const state = searchParams.get('state')
  const hmac = searchParams.get('hmac')

  // ── Validate required params ─────────────────────────────────────────────
  if (!code || !shop || !state || !hmac) {
    return NextResponse.redirect(
      new URL('/onboarding?error=missing_params', request.url)
    )
  }

  // ── Validate shop domain format ──────────────────────────────────────────
  if (!validateShopDomain(shop)) {
    return NextResponse.redirect(
      new URL('/onboarding?error=invalid_shop', request.url)
    )
  }

  // ── Validate HMAC signature ──────────────────────────────────────────────
  const queryParams: Record<string, string> = {}
  searchParams.forEach((value, key) => {
    queryParams[key] = value
  })

  if (!validateHmac(queryParams)) {
    return NextResponse.redirect(
      new URL('/onboarding?error=invalid_signature', request.url)
    )
  }

  // ── Validate OAuth state cookie ──────────────────────────────────────────
  const oauthStateCookie = request.cookies.get('shopify_oauth_state')?.value
  if (!oauthStateCookie) {
    return NextResponse.redirect(
      new URL('/onboarding?error=session_expired', request.url)
    )
  }

  let oauthState: {
    nonce: string
    workspaceSlug: string
    userId: string
    shopDomain: string
  }

  try {
    oauthState = JSON.parse(oauthStateCookie)
  } catch {
    return NextResponse.redirect(
      new URL('/onboarding?error=invalid_state', request.url)
    )
  }

  // Verify nonce matches the state parameter
  if (oauthState.nonce !== state) {
    return NextResponse.redirect(
      new URL('/onboarding?error=state_mismatch', request.url)
    )
  }

  // Verify shop domain matches
  if (oauthState.shopDomain !== shop) {
    return NextResponse.redirect(
      new URL('/onboarding?error=shop_mismatch', request.url)
    )
  }

  // ── Exchange code for access token ───────────────────────────────────────
  try {
    const { accessToken, scope } = await exchangeCodeForToken(shop, code)

    // Fetch the Shopify store ID
    let shopifyStoreId: string | null = null
    try {
      const shopInfo = await fetchShopInfo(shop, accessToken)
      shopifyStoreId = shopInfo.id
    } catch {
      // Non-critical: store ID is optional
    }

    // Find the workspace
    const workspace = await prisma.workspace.findUnique({
      where: { slug: oauthState.workspaceSlug },
    })

    if (!workspace) {
      return NextResponse.redirect(
        new URL('/onboarding?error=workspace_not_found', request.url)
      )
    }

    // Create or update the Shopify connection
    await prisma.shopifyConnection.upsert({
      where: {
        workspaceId_shopDomain: {
          workspaceId: workspace.id,
          shopDomain: shop,
        },
      },
      create: {
        workspaceId: workspace.id,
        shopDomain: shop,
        shopifyStoreId,
        accessToken,
        scopes: scope.split(','),
        status: 'CONNECTED',
      },
      update: {
        shopifyStoreId,
        accessToken,
        scopes: scope.split(','),
        status: 'CONNECTED',
        installedAt: new Date(),
      },
    })

    // Also update the workspace storeUrl for display purposes
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { storeUrl: shop },
    })

    // Clear the OAuth state cookie and redirect to dashboard
    const response = NextResponse.redirect(
      new URL(`/w/${oauthState.workspaceSlug}/dashboard`, request.url)
    )

    response.cookies.set('shopify_oauth_state', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })

    return response
  } catch (error) {
    console.error('Shopify OAuth callback error:', error)
    return NextResponse.redirect(
      new URL(
        `/w/${oauthState.workspaceSlug}/dashboard?error=shopify_connection_failed`,
        request.url
      )
    )
  }
}
