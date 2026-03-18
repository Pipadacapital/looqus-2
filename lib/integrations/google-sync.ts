import { prisma } from '@/lib/prisma'
import {
  refreshGoogleAccessToken,
  executeGaql,
  type GoogleAdsMetricRow,
} from './google'
import { Decimal } from '@prisma/client/runtime/library'
import { mapGoogleConversionActionToStage } from '@/lib/metrics/google-funnel-stage'
import {
  buildBackfillWindows,
  backfillStartDate,
  backfillEndDate,
  getBackfillDays,
  INCREMENTAL_SYNC_DAYS,
} from './ads-backfill'

export type GoogleSyncOptions = {
  /** Number of days to sync (incremental). Default 7. */
  days?: number
  /** If true, sync last 730 days (configurable) in 30-day chunks. */
  backfill?: boolean
}

function buildGaqlDateRange(since: string, until: string): string {
  return `segments.date BETWEEN '${since}' AND '${until}'`
}

export async function syncGoogleAdsForConnection(
  connectionId: string,
  options?: GoogleSyncOptions | number
): Promise<{ rowsSynced: number }> {
  const connection = await prisma.google_ads_connections.findUnique({
    where: { id: connectionId },
  })

  if (!connection || connection.status !== 'CONNECTED') return { rowsSynced: 0 }

  let targetCustomers = connection.selected_customer_ids?.length
    ? connection.selected_customer_ids
    : connection.selected_customer_id
      ? [connection.selected_customer_id]
      : []

  if (targetCustomers.length === 0 && connection.customer_ids.length === 1) {
    targetCustomers = [connection.customer_ids[0]]
    await prisma.google_ads_connections.update({
      where: { id: connection.id },
      data: {
        selected_customer_ids: targetCustomers,
        selected_customer_id: targetCustomers[0],
      },
    })
  }
  if (targetCustomers.length === 0) {
    await prisma.google_ads_connections.update({
      where: { id: connection.id },
      data: { last_sync_error: 'Select accounts under manager to sync.' },
    })
    return { rowsSynced: 0 }
  }

  const opts: GoogleSyncOptions =
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
    console.log(`[Google Ads] Backfill ${windows.length} windows: ${windows[0].since}..${windows[windows.length - 1].until}`)
  }

  const { accessToken } = await refreshGoogleAccessToken(connection.refresh_token)
  const errors: string[] = []
  let rowsSynced = 0

  for (const customerId of targetCustomers) {
    for (const { since: sinceStr, until: untilStr } of windows) {
      try {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Google Ads] Fetching customer ${customerId} ${sinceStr}..${untilStr}`)
        }
        const query = `
          SELECT
            campaign.id,
            campaign.name,
            segments.date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value,
            metrics.ctr,
            metrics.average_cpc
          FROM campaign
          WHERE ${buildGaqlDateRange(sinceStr, untilStr)}
            AND campaign.status != 'REMOVED'
          ORDER BY segments.date DESC
        `
        const results = await executeGaql(accessToken, customerId, query)
        if (process.env.NODE_ENV === 'development' && Array.isArray(results) && results.length > 0) {
          console.log(`[Google Ads] ${customerId} ${sinceStr}..${untilStr}: ${results.length} rows`)
        }
        for (const row of results as GoogleGaqlRow[]) {
          const campaign = row.campaign
          const metrics = row.metrics
          const date = row.segments?.date

          if (!campaign?.id || !date) continue

          const parsed: GoogleAdsMetricRow = {
            customerId,
            campaignId: String(campaign.id),
            campaignName: campaign.name || '',
            adGroupId: null,
            adGroupName: null,
            date,
            impressions: parseInt(metrics?.impressions || '0', 10),
            clicks: parseInt(metrics?.clicks || '0', 10),
            spend: (parseInt(metrics?.costMicros || '0', 10)) / 1_000_000,
            conversions: parseFloat(metrics?.conversions || '0'),
            conversionValue: parseFloat(metrics?.conversionsValue || '0'),
            ctr: parseFloat(metrics?.ctr || '0'),
            averageCpc: (parseInt(metrics?.averageCpc || '0', 10)) / 1_000_000,
            rawJson: row,
          }

          const dateOnly = new Date(parsed.date + 'T00:00:00.000Z')
          await prisma.google_ads_daily_metrics.upsert({
            where: {
              connection_id_customer_id_campaign_id_date: {
                connection_id: connection.id,
                customer_id: customerId,
                campaign_id: parsed.campaignId,
                date: dateOnly,
              },
            },
            create: {
              connection_id: connection.id,
              customer_id: customerId,
              campaign_id: parsed.campaignId,
              campaign_name: parsed.campaignName,
              date: dateOnly,
              impressions: parsed.impressions,
              clicks: parsed.clicks,
              spend: new Decimal(parsed.spend),
              conversions: new Decimal(parsed.conversions),
              conversion_value: new Decimal(parsed.conversionValue),
              ctr: new Decimal(parsed.ctr),
              average_cpc: new Decimal(parsed.averageCpc),
              raw_json: parsed.rawJson as object,
            },
            update: {
              campaign_name: parsed.campaignName,
              impressions: parsed.impressions,
              clicks: parsed.clicks,
              spend: new Decimal(parsed.spend),
              conversions: new Decimal(parsed.conversions),
              conversion_value: new Decimal(parsed.conversionValue),
              ctr: new Decimal(parsed.ctr),
              average_cpc: new Decimal(parsed.averageCpc),
              raw_json: parsed.rawJson as object,
            },
          })
          rowsSynced++
        }

        await syncGoogleFunnelStagesForWindow(
          connection.id,
          customerId,
          accessToken,
          sinceStr,
          untilStr,
          errors
        )
      } catch (err) {
        errors.push(`${customerId} ${sinceStr}..${untilStr}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  await prisma.google_ads_connections.update({
    where: { id: connection.id },
    data: {
      last_sync_at: new Date(),
      last_sync_error: errors.length > 0 ? errors.join('; ') : null,
    },
  })
  return { rowsSynced }
}

type GoogleGaqlRow = {
  campaign?: { id?: string; name?: string }
  metrics?: {
    impressions?: string
    clicks?: string
    costMicros?: string
    conversions?: string
    conversionsValue?: string
    ctr?: string
    averageCpc?: string
    allConversions?: string
  }
  segments?: { date?: string }
  conversionAction?: { category?: string | number; name?: string }
}

/** Numeric enum → name for conversion_action.category (subset). */
const CONV_CAT_NUM: Record<number, string> = {
  9: 'ADD_TO_CART',
  10: 'BEGIN_CHECKOUT',
  12: 'PURCHASE',
}

function normalizeConversionCategory(cat: unknown): string {
  if (typeof cat === 'string') return cat.toUpperCase().replace(/ /g, '_')
  if (typeof cat === 'number') return CONV_CAT_NUM[cat] ?? ''
  return ''
}

type FunnelAcc = { atc: number; ci: number; purch: number; purchVal: number }

async function syncGoogleFunnelStagesForWindow(
  connectionId: string,
  customerId: string,
  accessToken: string,
  sinceStr: string,
  untilStr: string,
  errors: string[]
): Promise<void> {
  const query = `
    SELECT
      campaign.id,
      segments.date,
      segments.conversion_action,
      conversion_action.category,
      conversion_action.name,
      metrics.conversions,
      metrics.all_conversions,
      metrics.conversions_value
    FROM campaign
    WHERE ${buildGaqlDateRange(sinceStr, untilStr)}
      AND campaign.status != 'REMOVED'
  `
  let rows: unknown[]
  try {
    rows = await executeGaql(accessToken, customerId, query)
  } catch (e) {
    errors.push(
      `Funnel GAQL ${customerId} ${sinceStr}..${untilStr}: ${e instanceof Error ? e.message : String(e)}`
    )
    return
  }

  const byKey = new Map<string, FunnelAcc>()
  const getAcc = (key: string): FunnelAcc => {
    let a = byKey.get(key)
    if (!a) {
      a = { atc: 0, ci: 0, purch: 0, purchVal: 0 }
      byKey.set(key, a)
    }
    return a
  }

  for (const row of rows) {
    const r = row as GoogleGaqlRow
    const campId = r.campaign?.id != null ? String(r.campaign.id) : ''
    const date = r.segments?.date
    const ca = r.conversionAction
    const met = r.metrics
    if (!campId || !date || !ca) continue

    const stage = mapGoogleConversionActionToStage(
      normalizeConversionCategory(ca.category),
      ca.name ?? ''
    )
    if (!stage) continue

    const conv = parseFloat(String(met?.conversions ?? '0')) || 0
    const allConv = parseFloat(String(met?.allConversions ?? '0')) || 0
    const val = parseFloat(String(met?.conversionsValue ?? '0')) || 0
    const key = `${customerId}|${campId}|${date}`
    const acc = getAcc(key)

    if (stage === 'add_to_cart') {
      acc.atc += allConv > 0 ? allConv : conv
    } else if (stage === 'checkout_initiated') {
      acc.ci += allConv > 0 ? allConv : conv
    } else {
      acc.purch += conv > 0 ? conv : allConv
      acc.purchVal += val
    }
  }

  const sinceD = new Date(sinceStr + 'T00:00:00.000Z')
  const untilD = new Date(untilStr + 'T00:00:00.000Z')
  await prisma.google_ads_funnel_daily.deleteMany({
    where: {
      connection_id: connectionId,
      customer_id: customerId,
      date: { gte: sinceD, lte: untilD },
    },
  })

  const records: {
    connection_id: string
    customer_id: string
    campaign_id: string
    date: Date
    stage: string
    conversions: Decimal
    conversion_value: Decimal
  }[] = []

  for (const [key, acc] of byKey) {
    const [, campaignId, dateStr] = key.split('|')
    const dateOnly = new Date(dateStr + 'T00:00:00.000Z')
    if (acc.atc > 0) {
      records.push({
        connection_id: connectionId,
        customer_id: customerId,
        campaign_id: campaignId,
        date: dateOnly,
        stage: 'add_to_cart',
        conversions: new Decimal(acc.atc),
        conversion_value: new Decimal(0),
      })
    }
    if (acc.ci > 0) {
      records.push({
        connection_id: connectionId,
        customer_id: customerId,
        campaign_id: campaignId,
        date: dateOnly,
        stage: 'checkout_initiated',
        conversions: new Decimal(acc.ci),
        conversion_value: new Decimal(0),
      })
    }
    if (acc.purch > 0 || acc.purchVal > 0) {
      records.push({
        connection_id: connectionId,
        customer_id: customerId,
        campaign_id: campaignId,
        date: dateOnly,
        stage: 'purchase',
        conversions: new Decimal(acc.purch),
        conversion_value: new Decimal(acc.purchVal),
      })
    }
  }

  const CHUNK = 200
  for (let i = 0; i < records.length; i += CHUNK) {
    await prisma.google_ads_funnel_daily.createMany({ data: records.slice(i, i + CHUNK) })
  }
}

export type SyncAllGoogleAdsResult = {
  connectionId: string
  workspaceId: string
  workspaceName: string
  status: 'ok' | 'failed'
  error?: string
  /** Number of daily metric rows fetched and upserted (no duplicates; existing rows updated). */
  rowsSynced?: number
}

export async function syncAllGoogleAds(
  days = INCREMENTAL_SYNC_DAYS,
  options?: { backfill?: boolean }
): Promise<{
  synced: number
  failed: number
  results: SyncAllGoogleAdsResult[]
}> {
  const connections = await prisma.google_ads_connections.findMany({
    where: { status: 'CONNECTED' },
    select: {
      id: true,
      workspace_id: true,
      workspaces: { select: { name: true } },
    },
  })

  const results: SyncAllGoogleAdsResult[] = []
  const syncOpts = options?.backfill ? { backfill: true } : { days }

  for (const c of connections) {
    try {
      const { rowsSynced } = await syncGoogleAdsForConnection(c.id, syncOpts)
      results.push({
        connectionId: c.id,
        workspaceId: c.workspace_id,
        workspaceName: c.workspaces?.name ?? 'Unknown',
        status: 'ok',
        rowsSynced,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Google Ads sync failed for connection ${c.id}:`, err)
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
