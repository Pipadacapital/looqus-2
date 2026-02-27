export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSuperadmin } from '@/lib/require-superadmin'
import { syncOrders, syncProducts, syncCustomers } from '@/lib/shopify/sync'
import { syncShopifyAnalyticsFromOrders } from '@/lib/shopify/analytics-sync'

type SyncResultRow = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  status: 'ok' | 'failed'
  error?: string
  rowsSynced?: number
}

/**
 * GET: list all Shopify connections (CONNECTED with accessToken). Superadmin only.
 */
export async function GET() {
  const auth = await requireSuperadmin()
  if ('error' in auth) return auth.error

  const connections = await prisma.shopifyConnection.findMany({
    where: { status: 'CONNECTED', accessToken: { not: null } },
    select: {
      id: true,
      workspaceId: true,
      shopDomain: true,
      lastSyncAt: true,
      workspace: { select: { name: true, slug: true } },
    },
  })

  return NextResponse.json({
    connections: connections.map((c) => ({
      connectionId: c.id,
      workspaceId: c.workspaceId,
      workspaceName: c.workspace?.name ?? 'Unknown',
      workspaceSlug: c.workspace?.slug ?? null,
      shopDomain: c.shopDomain,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    })),
    total: connections.length,
  })
}

/**
 * POST: sync Shopify for all connected workspaces.
 * - Default: full sync (orders, products, customers from Shopify API, then analytics from orders).
 * - ?analyticsOnly=true: only recompute daily analytics from existing orders in DB (no Shopify API calls). Fast refresh for dashboards.
 * Superadmin only. Returns synced/failed and per-connection results with rowsSynced (analytics days).
 */
export async function POST(request: Request) {
  const auth = await requireSuperadmin()
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const analyticsOnly = searchParams.get('analyticsOnly') === 'true'

  const connections = await prisma.shopifyConnection.findMany({
    where: { status: 'CONNECTED', accessToken: { not: null } },
    select: { id: true, workspaceId: true, workspace: { select: { name: true } } },
  })

  const results: SyncResultRow[] = []
  let synced = 0
  let failed = 0

  for (const c of connections) {
    try {
      // Define a reasonable window for analytics sync (last 365 days).
      const today = new Date()
      const to = today.toISOString().slice(0, 10)
      const fromDate = new Date(today)
      fromDate.setDate(fromDate.getDate() - 90)
      const from = fromDate.toISOString().slice(0, 10)

      if (!analyticsOnly) {
        await Promise.all([
          syncOrders(c.id),
          syncProducts(c.id),
          syncCustomers(c.id),
        ])
      }
      const { daysUpserted } = await syncShopifyAnalyticsFromOrders(c.id, from, to)
      if (!analyticsOnly) {
        await prisma.shopifyConnection.update({
          where: { id: c.id },
          data: { lastSyncAt: new Date() },
        })
      }
      results.push({
        connectionId: c.id,
        workspaceId: c.workspaceId,
        workspaceName: c.workspace?.name ?? 'Unknown',
        status: 'ok',
        rowsSynced: daysUpserted,
      })
      synced++
    } catch (err) {
      results.push({
        connectionId: c.id,
        workspaceId: c.workspaceId,
        workspaceName: c.workspace?.name ?? 'Unknown',
        status: 'failed',
        error: err instanceof Error ? err.message : 'Sync failed',
      })
      failed++
    }
  }

  return NextResponse.json({
    success: true,
    synced,
    failed,
    total: results.length,
    analyticsOnly,
    results,
  })
}
