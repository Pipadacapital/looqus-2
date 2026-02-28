import { prisma } from '@/lib/prisma'
import { fetchAdAccountInsights, type MetaInsightRow } from './meta'
import { Decimal } from '@prisma/client/runtime/library'

export async function syncMetaAdsForConnection(
  connectionId: string,
  days = 30
): Promise<{ rowsSynced: number }> {
  const connection = await prisma.meta_ads_connections.findUnique({
    where: { id: connectionId },
  })

  if (!connection || connection.status !== 'CONNECTED') return { rowsSynced: 0 }

  // Determine which accounts to sync (multi-select with legacy fallback)
  let targetAccounts = connection.selected_ad_account_ids?.length
    ? connection.selected_ad_account_ids
    : connection.selected_ad_account_id
      ? [connection.selected_ad_account_id]
      : []

  if (targetAccounts.length === 0 && connection.ad_account_ids.length === 1) {
    targetAccounts = [connection.ad_account_ids[0]]
    await prisma.meta_ads_connections.update({
      where: { id: connection.id },
      data: {
        selected_ad_account_ids: targetAccounts,
        selected_ad_account_id: targetAccounts[0],
      },
    })
  }
  if (targetAccounts.length === 0) {
    await prisma.meta_ads_connections.update({
      where: { id: connection.id },
      data: { last_sync_error: 'Select accounts under manager to sync.' },
    })
    return { rowsSynced: 0 }
  }

  const until = new Date()
  const since = new Date()
  since.setDate(since.getDate() - days)

  const sinceStr = since.toISOString().slice(0, 10)
  const untilStr = until.toISOString().slice(0, 10)

  const errors: string[] = []
  let rowsSynced = 0

  for (const adAccountId of targetAccounts) {
    try {
      const rows: MetaInsightRow[] = await fetchAdAccountInsights(
        connection.access_token,
        adAccountId,
        sinceStr,
        untilStr
      )

      for (const row of rows) {
        await prisma.meta_ads_daily_metrics.upsert({
          where: {
            connection_id_ad_account_id_campaign_id_date: {
              connection_id: connection.id,
              ad_account_id: adAccountId,
              campaign_id: row.campaignId,
              date: new Date(row.date),
            },
          },
          create: {
            connection_id: connection.id,
            ad_account_id: adAccountId,
            campaign_id: row.campaignId,
            campaign_name: row.campaignName,
            adset_id: row.adsetId,
            adset_name: row.adsetName,
            date: new Date(row.date),
            impressions: row.impressions,
            clicks: row.clicks,
            spend: new Decimal(row.spend),
            conversions: row.conversions,
            revenue: new Decimal(row.revenue),
            ctr: new Decimal(row.ctr),
            cpc: new Decimal(row.cpc),
            cpm: new Decimal(row.cpm),
            raw_json: row.rawJson as object,
          },
          update: {
            campaign_name: row.campaignName,
            adset_id: row.adsetId,
            adset_name: row.adsetName,
            impressions: row.impressions,
            clicks: row.clicks,
            spend: new Decimal(row.spend),
            conversions: row.conversions,
            revenue: new Decimal(row.revenue),
            ctr: new Decimal(row.ctr),
            cpc: new Decimal(row.cpc),
            cpm: new Decimal(row.cpm),
            raw_json: row.rawJson as object,
          },
        })
        rowsSynced++
      }
    } catch (err) {
      errors.push(`${adAccountId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  await prisma.meta_ads_connections.update({
    where: { id: connection.id },
    data: {
      last_sync_at: new Date(),
      last_sync_error: errors.length > 0 ? errors.join('; ') : null,
    },
  })
  return { rowsSynced }
}

export type SyncAllMetaAdsResult = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  status: 'ok' | 'failed'
  error?: string
  /** Number of daily metric rows fetched and upserted (no duplicates; existing rows updated). */
  rowsSynced?: number
}

export async function syncAllMetaAds(days = 30): Promise<{
  synced: number
  failed: number
  results: SyncAllMetaAdsResult[]
}> {
  const connections = await prisma.meta_ads_connections.findMany({
    where: { status: 'CONNECTED' },
    select: {
      id: true,
      workspace_id: true,
      workspaces: { select: { name: true } },
    },
  })

  const results: SyncAllMetaAdsResult[] = []

  for (const c of connections) {
    try {
      const { rowsSynced } = await syncMetaAdsForConnection(c.id, days)
      results.push({
        connectionId: c.id,
        workspaceId: c.workspace_id,
        workspaceName: c.workspaces?.name ?? 'Unknown',
        status: 'ok',
        rowsSynced,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Meta sync failed for connection ${c.id}:`, err)
      results.push({
        connectionId: c.id,
        workspaceId: c.workspace_id,
        workspaceName: c.workspaces?.name ?? 'Unknown',
        status: 'failed',
        error: message,
      })
    }
  }

  return {
    synced: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  }
}
