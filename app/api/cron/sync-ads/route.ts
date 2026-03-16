export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { syncAllMetaAds } from '@/lib/integrations/meta-sync'
import { syncAllGoogleAds } from '@/lib/integrations/google-sync'
import { syncAllShiprocket } from '@/lib/integrations/shiprocket-sync'
import { syncOrders, syncProducts, syncCustomers } from '@/lib/shopify/sync'
import { syncShopifyAnalyticsFromOrders, syncShopifySessionsFromShopifyQL } from '@/lib/shopify/analytics-sync'
import { prisma } from '@/lib/prisma'

/**
 * Hourly cron: syncs Google Ads and Meta Ads for the last N days (upsert by date),
 * syncs all Shiprocket orders + shipments, and syncs Shopify products/orders/customers.
 *
 * Using 5 days for ads so we re-fetch recent days every run; Meta/Google often have
 * 24–48h reporting delay, so yesterday's data may appear late. A larger window ensures
 * we pick it up when it becomes available.
 *
 * Schedule: e.g. 0 * * * * curl -X POST -H "x-cron-secret: $CRON_SECRET" https://your-app.com/api/cron/sync-ads
 */
const CRON_SYNC_DAYS = 5

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get('x-cron-secret')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const results: Record<string, string> = {}

  try {
    await syncAllMetaAds(CRON_SYNC_DAYS)
    results.meta = 'ok'
  } catch (err) {
    results.meta = err instanceof Error ? err.message : 'failed'
  }

  try {
    await syncAllGoogleAds(CRON_SYNC_DAYS)
    results.google = 'ok'
  } catch (err) {
    results.google = err instanceof Error ? err.message : 'failed'
  }

  try {
    await syncAllShiprocket({ days: 1 })
    results.shiprocket = 'ok'
  } catch (err) {
    results.shiprocket = err instanceof Error ? err.message : 'failed'
  }

  try {
    const connections = await prisma.shopifyConnection.findMany({
      where: { status: 'CONNECTED', accessToken: { not: null } },
      select: { id: true },
    })
    for (const c of connections) {
      const today = new Date()
      const to = today.toISOString().slice(0, 10)
      const fromDate = new Date(today)
      fromDate.setDate(fromDate.getDate() - (CRON_SYNC_DAYS - 1))
      const from = fromDate.toISOString().slice(0, 10)

      await Promise.all([
        syncOrders(c.id),
        syncProducts(c.id),
        syncCustomers(c.id),
      ])
      const { daysUpserted } = await syncShopifyAnalyticsFromOrders(c.id, from, to)
      try {
        await syncShopifySessionsFromShopifyQL(c.id, from, to)
      } catch {
        // Sessions/conversion optional
      }
      await prisma.shopifyConnection.update({
        where: { id: c.id },
        data: { lastSyncAt: new Date() },
      })
      // Temporary diagnostic: latest order date and latest analytics date after sync
      const [latestOrder, latestAnalytics] = await Promise.all([
        prisma.shopifyOrder.findFirst({ where: { connectionId: c.id }, orderBy: { processedAt: 'desc' }, select: { processedAt: true } }),
        prisma.shopifyAnalyticsDaily.findFirst({ where: { connectionId: c.id }, orderBy: { date: 'desc' }, select: { date: true } }),
      ])
      if (process.env.NODE_ENV === 'development') {
        console.log('[cron/sync-ads] Shopify sync diagnostic', {
          connectionId: c.id,
          analyticsRowsWritten: daysUpserted,
          latestShopifyOrderDate: latestOrder?.processedAt?.toISOString().slice(0, 10) ?? null,
          latestShopifyAnalyticsDailyDate: latestAnalytics?.date?.toISOString().slice(0, 10) ?? null,
        })
      }
    }
    results.shopify = 'ok'
  } catch (err) {
    results.shopify = err instanceof Error ? err.message : 'failed'
  }

  return NextResponse.json({ results })
}
