import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  validateHmac,
  validateShopDomain,
  exchangeCodeForToken,
  fetchShopInfo,
} from '@/lib/shopify/client'
import { registerWebhooks } from '@/lib/shopify/webhooks'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const shop = searchParams.get('shop')
  const state = searchParams.get('state')
  const hmac = searchParams.get('hmac')

  if (!code || !shop || !state || !hmac) {
    return NextResponse.redirect(
      new URL('/onboarding?error=missing_params', request.url)
    )
  }

  if (!validateShopDomain(shop)) {
    return NextResponse.redirect(
      new URL('/onboarding?error=invalid_shop', request.url)
    )
  }

  // Validate OAuth state cookie
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

  // Redirect to workspace dashboard with error so user can retry from Settings > Integrations
  const dashboardErrorUrl = (err: string) =>
    oauthState.workspaceSlug
      ? new URL(`/w/${oauthState.workspaceSlug}/dashboard?error=${err}`, request.url)
      : new URL(`/onboarding?error=${err}`, request.url)

  if (oauthState.nonce !== state) {
    return NextResponse.redirect(dashboardErrorUrl('state_mismatch'))
  }

  if (oauthState.shopDomain !== shop) {
    return NextResponse.redirect(dashboardErrorUrl('shop_mismatch'))
  }

  // Look up the pending connection to get per-store Client ID + Secret
  const workspace = await prisma.workspace.findUnique({
    where: { slug: oauthState.workspaceSlug },
  })

  if (!workspace) {
    return NextResponse.redirect(
      new URL('/onboarding?error=workspace_not_found', request.url)
    )
  }

  const pendingConnection = await prisma.shopifyConnection.findUnique({
    where: {
      workspaceId_shopDomain: {
        workspaceId: workspace.id,
        shopDomain: shop,
      },
    },
    select: { clientId: true, clientSecret: true },
  })

  if (!pendingConnection) {
    return NextResponse.redirect(
      new URL(
        `/w/${oauthState.workspaceSlug}/dashboard?error=connection_not_found`,
        request.url
      )
    )
  }

  // Validate HMAC using the per-store client secret
  const queryParams: Record<string, string> = {}
  searchParams.forEach((value, key) => {
    queryParams[key] = value
  })

  if (!validateHmac(queryParams, pendingConnection.clientSecret)) {
    return NextResponse.redirect(
      new URL(
        `/w/${oauthState.workspaceSlug}/dashboard?error=invalid_signature`,
        request.url
      )
    )
  }

  // Exchange code for a permanent offline access token
  try {
    const { accessToken, scope } = await exchangeCodeForToken(
      shop,
      code,
      pendingConnection.clientId,
      pendingConnection.clientSecret
    )

    let shopifyStoreId: string | null = null
    try {
      const shopInfo = await fetchShopInfo(shop, accessToken)
      shopifyStoreId = shopInfo.id
    } catch {
      // Non-critical
    }

    await prisma.shopifyConnection.update({
      where: {
        workspaceId_shopDomain: {
          workspaceId: workspace.id,
          shopDomain: shop,
        },
      },
      data: {
        shopifyStoreId,
        accessToken,
        tokenExpiresAt: null,
        scopes: scope.split(','),
        status: 'CONNECTED',
        installedAt: new Date(),
      },
    })

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { storeUrl: shop },
    })

    // Register webhooks so we receive real-time orders, products, customers, inventory
    try {
      const { registered, errors } = await registerWebhooks(shop, accessToken)
      if (errors.length > 0 && process.env.NODE_ENV === 'development') {
        console.warn('[Shopify callback] Webhook registration had errors:', errors)
      }
      if (registered > 0 && process.env.NODE_ENV === 'development') {
        console.log(`[Shopify callback] Registered ${registered} webhook(s) for ${shop}`)
      }
    } catch (webhookErr) {
      console.warn('[Shopify callback] Webhook registration failed:', webhookErr)
      // Do not block redirect; user can still use manual sync
    }

    // Clear cookie and redirect to dashboard
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
