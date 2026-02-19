export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateOAuthState } from '@/lib/integrations/oauth-state'
import {
  exchangeGoogleCode,
  listAccessibleCustomers,
  listManagerChildAccounts,
  fetchGoogleUserEmail,
} from '@/lib/integrations/google'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/?error=google_auth_denied&reason=${errorParam}`, request.url)
    )
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/?error=google_missing_params', request.url)
    )
  }

  const oauthRecord = await validateOAuthState(state, 'GOOGLE')
  if (!oauthRecord) {
    return NextResponse.redirect(
      new URL('/?error=google_invalid_state', request.url)
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

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!developerToken) {
    await prisma.googleAdsConnection.upsert({
      where: { workspaceId: workspace.id },
      create: {
        workspaceId: workspace.id,
        refreshToken: '',
        scopes: [],
        customerIds: [],
        status: 'ERROR',
        lastSyncError: 'GOOGLE_ADS_DEVELOPER_TOKEN is not configured on the server.',
      },
      update: {
        status: 'ERROR',
        lastSyncError: 'GOOGLE_ADS_DEVELOPER_TOKEN is not configured on the server.',
      },
    })
    return NextResponse.redirect(
      new URL(`/w/${workspace.slug}/dashboard?error=google_developer_token_missing`, request.url)
    )
  }

  try {
    const { accessToken, refreshToken } = await exchangeGoogleCode(code)

    let customerIds: string[] = []
    let lastSyncError: string | null = null

    // Step 1: Try listAccessibleCustomers
    try {
      customerIds = await listAccessibleCustomers(accessToken)
    } catch (err) {
      lastSyncError = `listAccessibleCustomers failed: ${err instanceof Error ? err.message : String(err)}`
    }

    // Step 2: If empty and LOGIN_CUSTOMER_ID is set, try MCC child discovery
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null
    if (customerIds.length === 0 && loginCustomerId) {
      try {
        customerIds = await listManagerChildAccounts(accessToken, loginCustomerId)
        if (customerIds.length > 0) lastSyncError = null
      } catch (err) {
        const mccErr = `MCC child listing failed: ${err instanceof Error ? err.message : String(err)}`
        lastSyncError = lastSyncError ? `${lastSyncError}; ${mccErr}` : mccErr
      }
    }

    if (customerIds.length === 0 && !lastSyncError) {
      lastSyncError = 'No Google Ads customers found. Check that the authorized Google account has access to at least one Google Ads customer.'
    }

    let googleEmail: string | null = null
    try {
      googleEmail = await fetchGoogleUserEmail(accessToken)
    } catch {
      // Non-critical
    }

    // Auto-select if exactly one customer
    const selectedCustomerId = customerIds.length === 1 ? customerIds[0] : null

    await prisma.googleAdsConnection.upsert({
      where: { workspaceId: workspace.id },
      create: {
        workspaceId: workspace.id,
        refreshToken,
        scopes: ['https://www.googleapis.com/auth/adwords'],
        customerIds,
        selectedCustomerId,
        loginCustomerId,
        googleEmail,
        status: 'CONNECTED',
        lastSyncError,
      },
      update: {
        refreshToken,
        scopes: ['https://www.googleapis.com/auth/adwords'],
        customerIds,
        selectedCustomerId,
        loginCustomerId,
        googleEmail,
        status: 'CONNECTED',
        lastSyncError,
      },
    })

    return NextResponse.redirect(
      new URL(`/w/${workspace.slug}/dashboard`, request.url)
    )
  } catch (error) {
    console.error('Google OAuth callback error:', error)
    return NextResponse.redirect(
      new URL(
        `/w/${workspace.slug}/dashboard?error=google_connection_failed`,
        request.url
      )
    )
  }
}
