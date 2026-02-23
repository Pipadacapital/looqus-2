import { prisma } from '@/lib/prisma'
import { fetchAdAccountInsights, type MetaInsightRow } from './meta'
import { Decimal } from '@prisma/client/runtime/library'

export async function syncMetaAdsForConnection(connectionId: string, days = 30) {
  const connection = await prisma.meta_ads_connections.findUnique({
    where: { id: connectionId },
  })

  if (!connection || connection.status !== 'CONNECTED') return

  // Determine which account to sync
  let targetAccount = connection.selected_ad_account_id
  if (!targetAccount && connection.ad_account_ids.length === 1) {
    targetAccount = connection.ad_account_ids[0]
    await prisma.meta_ads_connections.update({
      where: { id: connection.id },
      data: { selected_ad_account_id: targetAccount },
    })
  }
  if (!targetAccount) {
    await prisma.meta_ads_connections.update({
      where: { id: connection.id },
      data: { last_sync_error: 'Multiple ad accounts available — please select one before syncing.' },
    })
    return
  }

  const until = new Date()
  const since = new Date()
  since.setDate(since.getDate() - days)

  const sinceStr = since.toISOString().slice(0, 10)
  const untilStr = until.toISOString().slice(0, 10)

  const errors: string[] = []

  for (const adAccountId of [targetAccount]) {
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
}

export type SyncAllMetaAdsResult = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  status: 'ok' | 'failed'
  error?: string
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
      await syncMetaAdsForConnection(c.id, days)
      results.push({
        connectionId: c.id,
        workspaceId: c.workspace_id,
        workspaceName: c.workspaces?.name ?? 'Unknown',
        status: 'ok',
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
