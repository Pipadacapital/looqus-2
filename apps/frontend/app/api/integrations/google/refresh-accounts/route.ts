export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import {
  refreshGoogleAccessToken,
  listAccessibleCustomers,
  listManagerChildAccounts,
} from '@/lib/integrations/google'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { workspaceId } = body as { workspaceId?: string }

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  const result = await requireWorkspaceAdmin(workspaceId)
  if ('error' in result) return result.error

  const connection = await prisma.google_ads_connections.findUnique({
    where: { workspace_id: workspaceId },
  })

  if (!connection || connection.status !== 'CONNECTED') {
    return NextResponse.json(
      { error: 'No active Google Ads connection found' },
      { status: 404 }
    )
  }

  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    return NextResponse.json(
      { error: 'GOOGLE_ADS_DEVELOPER_TOKEN is not configured' },
      { status: 500 }
    )
  }

  try {
    const { accessToken } = await refreshGoogleAccessToken(connection.refresh_token)

    let customerIds: string[] = []
    let lastSyncError: string | null = null

    try {
      customerIds = await listAccessibleCustomers(accessToken)
    } catch (err) {
      lastSyncError = `listAccessibleCustomers: ${err instanceof Error ? err.message : String(err)}`
    }

    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null
    if (customerIds.length === 0 && loginCustomerId) {
      try {
        customerIds = await listManagerChildAccounts(accessToken, loginCustomerId)
        if (customerIds.length > 0) lastSyncError = null
      } catch (err) {
        const mccErr = `MCC child listing: ${err instanceof Error ? err.message : String(err)}`
        lastSyncError = lastSyncError ? `${lastSyncError}; ${mccErr}` : mccErr
      }
    }

    if (customerIds.length === 0 && !lastSyncError) {
      lastSyncError = 'No Google Ads customers found. Check account permissions.'
    }

    // Keep current selection if still valid, otherwise auto-select if exactly one
    let selectedCustomerId = connection.selected_customer_id
    if (selectedCustomerId && !customerIds.includes(selectedCustomerId)) {
      selectedCustomerId = null
    }
    if (!selectedCustomerId && customerIds.length === 1) {
      selectedCustomerId = customerIds[0]
    }

    await prisma.google_ads_connections.update({
      where: { id: connection.id },
      data: {
        customer_ids: customerIds,
        selected_customer_id: selectedCustomerId,
        login_customer_id: loginCustomerId,
        last_sync_error: lastSyncError,
      },
    })

    return NextResponse.json({ ok: true, customerIds, selectedCustomerId, lastSyncError })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to refresh accounts' },
      { status: 500 }
    )
  }
}
