import { prisma } from '@/lib/prisma'
import {
  fetchAdAccountInsights,
  fetchAdAccountAdInsights,
  fetchMetaAdAccountCurrency,
  type MetaInsightRow,
} from './meta'
import { Decimal } from '@prisma/client/runtime/library'
import {
  buildBackfillWindows,
  backfillStartDate,
  backfillEndDate,
  getBackfillDays,
  INCREMENTAL_SYNC_DAYS,
} from './ads-backfill'

export type MetaSyncOptions = {
  /** Number of days to sync (incremental). Default 7. */
  days?: number
  /** If true, sync last 730 days (configurable) in 30-day chunks. */
  backfill?: boolean
}

export async function syncMetaAdsForConnection(
  connectionId: string,
  options?: MetaSyncOptions | number
): Promise<{ rowsSynced: number }> {
  const connection = await prisma.meta_ads_connections.findUnique({
    where: { id: connectionId },
  })

  if (!connection || connection.status !== 'CONNECTED') return { rowsSynced: 0 }

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

  const currencyAccountId = targetAccounts[0]
  if (currencyAccountId) {
    try {
      const currency = await fetchMetaAdAccountCurrency(connection.access_token, currencyAccountId)
      if (currency) {
        await prisma.meta_ads_connections.update({
          where: { id: connection.id },
          data: { currency },
        })
      }
    } catch {
      // Non-blocking: metrics sync should continue even if account currency fetch fails.
    }
  }

  const opts: MetaSyncOptions =
    options == null ? { days: INCREMENTAL_SYNC_DAYS } : typeof options === 'number' ? { days: options } : options

  const windows: { since: string; until: string }[] = opts.backfill
    ? buildBackfillWindows(backfillStartDate(getBackfillDays()), backfillEndDate(), 30)
    : (() => {
        const end = new Date()
        end.setUTCHours(23, 59, 59, 999)
        const start = new Date(end)
        start.setUTCDate(start.getUTCDate() - (opts.days ?? INCREMENTAL_SYNC_DAYS) + 1)
        start.setUTCHours(0, 0, 0, 0)
        return [{ since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) }]
      })()

  if (process.env.NODE_ENV === 'development' && windows.length > 1) {
    console.log(`[Meta Ads] Backfill ${windows.length} windows: ${windows[0].since}..${windows[windows.length - 1].until}`)
  }

  const errors: string[] = []
  let rowsSynced = 0

  for (const adAccountId of targetAccounts) {
    for (const { since: sinceStr, until: untilStr } of windows) {
      try {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Meta Ads] Fetching ${adAccountId} ${sinceStr}..${untilStr}`)
        }
        const rows: MetaInsightRow[] = await fetchAdAccountInsights(
          connection.access_token,
          adAccountId,
          sinceStr,
          untilStr
        )
        if (process.env.NODE_ENV === 'development' && rows.length > 0) {
          console.log(`[Meta Ads] ${adAccountId} ${sinceStr}..${untilStr}: ${rows.length} rows`)
        }
        for (const row of rows) {
          const dateOnly = new Date(row.date)
          dateOnly.setUTCHours(0, 0, 0, 0)
          await prisma.meta_ads_daily_metrics.upsert({
            where: {
              connection_id_ad_account_id_campaign_id_date: {
                connection_id: connection.id,
                ad_account_id: adAccountId,
                campaign_id: row.campaignId,
                date: dateOnly,
              },
            },
            create: {
              connection_id: connection.id,
              ad_account_id: adAccountId,
              campaign_id: row.campaignId,
              campaign_name: row.campaignName,
              adset_id: row.adsetId,
              adset_name: row.adsetName,
              date: dateOnly,
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
        errors.push(`${adAccountId} ${sinceStr}..${untilStr}: ${err instanceof Error ? err.message : String(err)}`)
      }

      try {
        const adRows = await fetchAdAccountAdInsights(
          connection.access_token,
          adAccountId,
          sinceStr,
          untilStr
        )
        for (const row of adRows) {
          if (!row.adId) continue
          const dateOnly = new Date(row.date + 'T00:00:00.000Z')
          dateOnly.setUTCHours(0, 0, 0, 0)
          try {
            await prisma.meta_ads_creative_daily.upsert({
              where: {
                connection_id_ad_account_id_ad_id_date: {
                  connection_id: connection.id,
                  ad_account_id: adAccountId,
                  ad_id: row.adId,
                  date: dateOnly,
                },
              },
              create: {
                connection_id: connection.id,
                ad_account_id: adAccountId,
                ad_id: row.adId,
                ad_name: row.adName,
                campaign_id: row.campaignId,
                campaign_name: row.campaignName,
                adset_id: row.adsetId,
                adset_name: row.adsetName,
                date: dateOnly,
                impressions: row.impressions,
                clicks: row.clicks,
                spend: new Decimal(row.spend),
                video_3s_views: row.video3s,
                video_thruplay: row.thruplay,
                avg_watch_sec: new Decimal(row.avgWatchSec),
                video_p25: row.p25,
                video_p50: row.p50,
                video_p75: row.p75,
                video_p95: row.p95,
                conversions: row.conversions,
                revenue: new Decimal(row.revenue),
                raw_json: row.rawJson as object,
              },
              update: {
                ad_name: row.adName,
                campaign_name: row.campaignName,
                adset_id: row.adsetId,
                adset_name: row.adsetName,
                impressions: row.impressions,
                clicks: row.clicks,
                spend: new Decimal(row.spend),
                video_3s_views: row.video3s,
                video_thruplay: row.thruplay,
                avg_watch_sec: new Decimal(row.avgWatchSec),
                video_p25: row.p25,
                video_p50: row.p50,
                video_p75: row.p75,
                video_p95: row.p95,
                conversions: row.conversions,
                revenue: new Decimal(row.revenue),
                raw_json: row.rawJson as object,
              },
            })
            rowsSynced++
          } catch (rowErr) {
            errors.push(
              `Creative row ${row.adId} ${row.date}: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`
            )
          }
        }
      } catch (adErr) {
        errors.push(
          `Ad creative ${adAccountId} ${sinceStr}..${untilStr}: ${adErr instanceof Error ? adErr.message : String(adErr)}`
        )
      }
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

export async function syncAllMetaAds(
  days = INCREMENTAL_SYNC_DAYS,
  options?: { backfill?: boolean }
): Promise<{
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
  const syncOpts = options?.backfill ? { backfill: true } : { days }

  for (const c of connections) {
    try {
      const { rowsSynced } = await syncMetaAdsForConnection(c.id, syncOpts)
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
