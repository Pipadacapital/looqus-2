import { prisma } from '@/lib/prisma'
import {
  refreshGoogleAccessToken,
  executeGaql,
  fetchGoogleCustomerCurrency,
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
  const currencyCustomerId = targetCustomers[0]
  if (currencyCustomerId) {
    try {
      const currency = await fetchGoogleCustomerCurrency(accessToken, currencyCustomerId)
      if (currency) {
        await prisma.google_ads_connections.update({
          where: { id: connection.id },
          data: { currency },
        })
      }
    } catch {
      // Non-blocking: metrics sync should continue even if customer currency fetch fails.
    }
  }
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
  segments?: {
    date?: string
    conversionAction?: string
    conversionActionCategory?: string | number
    conversionActionName?: string
  }
}

/**
 * conversion_action_category enum ints → name (google.ads.googleads.v23.enums.ConversionActionCategory).
 * Prior mapping was off by several ordinals, so numeric categories never matched ADD_TO_CART / PURCHASE.
 */
const CONV_CAT_NUM: Record<number, string> = {
  4: 'PURCHASE',
  8: 'ADD_TO_CART',
  9: 'BEGIN_CHECKOUT',
}

function normalizeConversionCategory(cat: unknown): string {
  if (typeof cat === 'number' && Number.isFinite(cat)) {
    return CONV_CAT_NUM[cat] ?? ''
  }
  if (typeof cat === 'string') {
    const t = cat.trim()
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10)
      return CONV_CAT_NUM[n] ?? ''
    }
    let u = t.toUpperCase().replace(/ /g, '_')
    const dot = u.lastIndexOf('.')
    if (dot >= 0) u = u.slice(dot + 1)
    const prefix = 'CONVERSION_ACTION_CATEGORY_'
    if (u.startsWith(prefix)) u = u.slice(prefix.length)
    return u
  }
  return ''
}

function gaqlEscapeSingleQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

type ConversionActionMeta = { category: unknown; name: string }

/** Authoritative category + name; campaign segment fields are sometimes wrong/empty for ATC. */
async function fetchConversionActionMetaMap(
  accessToken: string,
  customerId: string,
  resourceNames: string[]
): Promise<Map<string, ConversionActionMeta>> {
  const map = new Map<string, ConversionActionMeta>()
  const unique = [...new Set(resourceNames)].filter(Boolean)
  const CHUNK = 80
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK)
    const inList = slice.map((r) => `'${gaqlEscapeSingleQuoted(r)}'`).join(', ')
    const q = `
      SELECT
        conversion_action.resource_name,
        conversion_action.category,
        conversion_action.name
      FROM conversion_action
      WHERE conversion_action.resource_name IN (${inList})
    `
    try {
      const caRows = await executeGaql(accessToken, customerId, q)
      for (const raw of caRows) {
        const row = raw as {
          conversionAction?: {
            resourceName?: string
            resource_name?: string
            category?: unknown
            name?: string
          }
        }
        const ca = row.conversionAction
        const rn =
          (typeof ca?.resourceName === 'string' && ca.resourceName) ||
          (typeof ca?.resource_name === 'string' && ca.resource_name) ||
          ''
        if (!rn) continue
        map.set(rn, {
          category: ca?.category,
          name: typeof ca?.name === 'string' ? ca.name : '',
        })
      }
    } catch {
      // Chunk failed; rely on segment fields for those actions
    }
  }
  return map
}

function readCampaignConversionRow(row: unknown): {
  campaignId: string
  date?: string
  conversionActionRn?: string
  segmentCategory?: string | number
  segmentName: string
  conversions: string | undefined
  allConversions: string | undefined
  conversionsValue: string | undefined
} {
  const r = row as Record<string, unknown>
  const camp = r.campaign as Record<string, unknown> | undefined
  const campaignId = camp?.id != null ? String(camp.id) : ''
  const seg = (r.segments as Record<string, unknown> | undefined) ?? {}
  const met = (r.metrics as Record<string, unknown> | undefined) ?? {}

  const rnRaw =
    (seg.conversionAction as string | undefined) ??
    (seg.conversion_action as string | undefined)
  const conversionActionRn = typeof rnRaw === 'string' ? rnRaw.trim() : undefined

  const segmentCategory =
    (seg.conversionActionCategory as string | number | undefined) ??
    (seg.conversion_action_category as string | number | undefined)

  const segmentName = String(
    seg.conversionActionName ?? seg.conversion_action_name ?? ''
  )

  const allConv =
    met.allConversions != null
      ? String(met.allConversions)
      : met.all_conversions != null
        ? String(met.all_conversions)
        : undefined

  return {
    campaignId,
    date: seg.date as string | undefined,
    conversionActionRn,
    segmentCategory,
    segmentName,
    conversions: met.conversions != null ? String(met.conversions) : undefined,
    allConversions: allConv,
    conversionsValue:
      met.conversionsValue != null
        ? String(met.conversionsValue)
        : met.conversions_value != null
          ? String(met.conversions_value)
          : undefined,
  }
}

type FunnelAcc = { atc: number; ci: number; purch: number; purchVal: number }

/**
 * Sum all conversions in Google's ADD_TO_CART category per campaign × day.
 * Per–conversion-action rows often omit or mis-segment ATC; category roll-up matches UI totals.
 */
async function fetchAddToCartTotalsByCategory(
  accessToken: string,
  customerId: string,
  sinceStr: string,
  untilStr: string
): Promise<Map<string, number>> {
  const q = `
    SELECT
      campaign.id,
      segments.date,
      segments.conversion_action_category,
      metrics.all_conversions,
      metrics.conversions
    FROM campaign
    WHERE ${buildGaqlDateRange(sinceStr, untilStr)}
      AND campaign.status != 'REMOVED'
      AND segments.conversion_action_category = 'ADD_TO_CART'
  `
  try {
    const resultRows = await executeGaql(accessToken, customerId, q)
    const map = new Map<string, number>()
    for (const row of resultRows) {
      const p = readCampaignConversionRow(row)
      if (!p.campaignId || !p.date) continue
      const conv = parseFloat(String(p.conversions ?? '0')) || 0
      const allConv = parseFloat(String(p.allConversions ?? '0')) || 0
      const v = allConv > 0 ? allConv : conv
      const key = `${customerId}|${p.campaignId}|${p.date}`
      map.set(key, (map.get(key) ?? 0) + v)
    }
    return map
  } catch {
    return new Map()
  }
}

/** When category-segment query returns nothing, sum metrics for actions whose definition is ADD_TO_CART. */
async function fetchAddToCartResourceNames(
  accessToken: string,
  customerId: string
): Promise<Set<string>> {
  const q = `
    SELECT conversion_action.resource_name
    FROM conversion_action
    WHERE conversion_action.category = 'ADD_TO_CART'
      AND conversion_action.status != 'REMOVED'
  `
  try {
    const resultRows = await executeGaql(accessToken, customerId, q)
    const set = new Set<string>()
    for (const raw of resultRows) {
      const row = raw as {
        conversionAction?: { resourceName?: string; resource_name?: string }
      }
      const rn =
        (typeof row.conversionAction?.resourceName === 'string' && row.conversionAction.resourceName) ||
        (typeof row.conversionAction?.resource_name === 'string' && row.conversionAction.resource_name) ||
        ''
      if (rn) set.add(rn)
    }
    return set
  } catch {
    return new Set()
  }
}

function sumAddToCartMetricsFromRows(
  rows: unknown[],
  customerId: string,
  atcRnSet: Set<string>
): Map<string, number> {
  const map = new Map<string, number>()
  if (atcRnSet.size === 0) return map
  for (const row of rows) {
    const p = readCampaignConversionRow(row)
    const rn = p.conversionActionRn ?? ''
    if (!p.campaignId || !p.date || !rn || !atcRnSet.has(rn)) continue
    const conv = parseFloat(String(p.conversions ?? '0')) || 0
    const allConv = parseFloat(String(p.allConversions ?? '0')) || 0
    const v = allConv > 0 ? allConv : conv
    const key = `${customerId}|${p.campaignId}|${p.date}`
    map.set(key, (map.get(key) ?? 0) + v)
  }
  return map
}

async function syncGoogleFunnelStagesForWindow(
  connectionId: string,
  customerId: string,
  accessToken: string,
  sinceStr: string,
  untilStr: string,
  errors: string[]
): Promise<void> {
  // Use segments.* only — selecting conversion_action.* with FROM campaign is invalid (PROHIBITED_RESOURCE_TYPE_IN_SELECT_CLAUSE in v23+).
  const query = `
    SELECT
      campaign.id,
      segments.date,
      segments.conversion_action,
      segments.conversion_action_category,
      segments.conversion_action_name,
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

  const convResourceNames: string[] = []
  for (const row of rows) {
    const p = readCampaignConversionRow(row)
    if (p.conversionActionRn) convResourceNames.push(p.conversionActionRn)
  }
  const [actionMeta, atcByCategoryKey] = await Promise.all([
    fetchConversionActionMetaMap(accessToken, customerId, convResourceNames),
    fetchAddToCartTotalsByCategory(accessToken, customerId, sinceStr, untilStr),
  ])

  let atcRnSet = new Set<string>()
  let atcByResourceNameKey = new Map<string, number>()
  if (atcByCategoryKey.size === 0) {
    atcRnSet = await fetchAddToCartResourceNames(accessToken, customerId)
    atcByResourceNameKey = sumAddToCartMetricsFromRows(rows, customerId, atcRnSet)
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
    const p = readCampaignConversionRow(row)
    const { campaignId: campId, date } = p
    if (!campId || !date) continue

    const rn = p.conversionActionRn ?? ''
    const meta = rn ? actionMeta.get(rn) : undefined
    const categoryRaw =
      meta?.category !== undefined && meta?.category !== null
        ? meta.category
        : p.segmentCategory
    const name =
      (meta?.name && meta.name.trim()) ||
      (p.segmentName && p.segmentName.trim()) ||
      ''

    const normCat = normalizeConversionCategory(categoryRaw)
    const stage = mapGoogleConversionActionToStage(normCat, name)
    if (!stage) continue

    const conv = parseFloat(String(p.conversions ?? '0')) || 0
    const allConv = parseFloat(String(p.allConversions ?? '0')) || 0
    const val = parseFloat(String(p.conversionsValue ?? '0')) || 0
    const key = `${customerId}|${campId}|${date}`
    const acc = getAcc(key)

    if (stage === 'add_to_cart') {
      const rn = p.conversionActionRn ?? ''
      if (atcByCategoryKey.size > 0 && normCat === 'ADD_TO_CART') {
        continue
      }
      if (atcRnSet.size > 0 && atcRnSet.has(rn)) {
        continue
      }
      acc.atc += allConv > 0 ? allConv : conv
    } else if (stage === 'checkout_initiated') {
      acc.ci += allConv > 0 ? allConv : conv
    } else {
      acc.purch += conv > 0 ? conv : allConv
      acc.purchVal += val
    }
  }

  for (const [key, v] of atcByCategoryKey) {
    if (v <= 0) continue
    const acc = getAcc(key)
    acc.atc += v
  }
  for (const [key, v] of atcByResourceNameKey) {
    if (v <= 0) continue
    const acc = getAcc(key)
    acc.atc += v
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
