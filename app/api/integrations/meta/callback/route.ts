export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateOAuthState } from '@/lib/integrations/oauth-state'
import {
  exchangeMetaCode,
  exchangeForLongLivedToken,
  fetchMetaAdAccounts,
  fetchMetaUserId,
} from '@/lib/integrations/meta'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/?error=meta_auth_denied&reason=${errorParam}`, request.url)
    )
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/?error=meta_missing_params', request.url)
    )
  }

  const oauthRecord = await validateOAuthState(state, 'META')
  if (!oauthRecord) {
    return NextResponse.redirect(
      new URL('/?error=meta_invalid_state', request.url)
    )
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: oauthRecord.workspaceId },
    select: { slug: true, id: true },
  })

  if (!workspace) {
    return NextResponse.redirect(
      new URL('/?error=workspace_not_found', request.url)
    )
  }

  try {
    const { accessToken: shortToken } = await exchangeMetaCode(code)
    const { accessToken, expiresIn } = await exchangeForLongLivedToken(shortToken)

    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : null

    // Fetch ad accounts and user ID (best effort)
    let adAccountIds: string[] = []
    let metaUserId: string | null = null

    try {
      const accounts = await fetchMetaAdAccounts(accessToken)
      adAccountIds = accounts.map((a) => a.id)
    } catch {
      // Will show UI message to reconfigure
    }

    try {
      metaUserId = await fetchMetaUserId(accessToken)
    } catch {
      // Non-critical
    }

    const now = new Date()
    await prisma.meta_ads_connections.upsert({
      where: { workspace_id: workspace.id },
      create: {
        workspace_id: workspace.id,
        access_token: accessToken,
        token_expires_at: tokenExpiresAt,
        scopes: ['ads_management', 'ads_read', 'business_management', 'read_insights'],
        ad_account_ids: adAccountIds,
        meta_user_id: metaUserId,
        status: 'CONNECTED',
        updated_at: now,
      },
      update: {
        access_token: accessToken,
        token_expires_at: tokenExpiresAt,
        scopes: ['ads_management', 'ads_read', 'business_management', 'read_insights'],
        ad_account_ids: adAccountIds,
        meta_user_id: metaUserId,
        status: 'CONNECTED',
        last_sync_error: null,
        updated_at: now,
      },
    })

    return NextResponse.redirect(
      new URL(`/w/${workspace.slug}/dashboard`, request.url)
    )
  } catch (error) {
    console.error('Meta OAuth callback error:', error)
    return NextResponse.redirect(
      new URL(
        `/w/${workspace.slug}/dashboard?error=meta_connection_failed`,
        request.url
      )
    )
  }
}
