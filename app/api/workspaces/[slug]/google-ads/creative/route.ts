export const runtime = 'nodejs'
export const maxDuration = 300

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'
import { refreshGoogleAccessToken, executeGaql } from '@/lib/integrations/google'
import { loadCampaignIntentMap, resolveCampaignIntent } from '@/lib/metrics/campaign-classification'
import { matchesIntentFilter } from '@/lib/metrics/ad-intent-split'

const DEFAULT_DAYS = 30
const MAX_DAYS = 90

type GaqlRow = {
  campaign?: {
    id?: string | number
    name?: string
    advertisingChannelType?: string
  }
  adGroup?: { id?: string | number; name?: string }
  adGroupAd?: {
    status?: string
    ad?: {
      id?: string | number
      name?: string
      type?: string
      finalUrls?: string[]
      responsiveSearchAd?: { headlines?: Array<{ text?: string }> }
      imageAd?: { imageUrl?: string }
      videoAd?: { video?: string }
      responsiveDisplayAd?: {
        marketingImages?: string[]
        squareMarketingImages?: string[]
        logoImages?: string[]
      }
      videoResponsiveAd?: { videos?: string[] }
      demandGenMultiAssetAd?: {
        marketingImages?: string[]
        squareMarketingImages?: string[]
      }
      demandGenVideoResponsiveAd?: { videos?: string[] }
    }
  }
  metrics?: {
    impressions?: string
    clicks?: string
    costMicros?: string
    conversions?: string
    conversionsValue?: string
  }
  segments?: { date?: string }
}

function buildDateRangeWhere(from: string, until: string): string {
  return `segments.date BETWEEN '${from}' AND '${until}'`
}

/** Extra ad fields for previews — Demand Gen / legacy video paths often break on older API versions; we fall back. */
const GAQL_AD_FIELDS_FULL = `
      ad_group_ad.ad.image_ad.image_url,
      ad_group_ad.ad.video_ad.video,
      ad_group_ad.ad.responsive_display_ad.marketing_images,
      ad_group_ad.ad.responsive_display_ad.square_marketing_images,
      ad_group_ad.ad.responsive_display_ad.logo_images,
      ad_group_ad.ad.video_responsive_ad.videos,
      ad_group_ad.ad.demand_gen_multi_asset_ad.marketing_images,
      ad_group_ad.ad.demand_gen_multi_asset_ad.square_marketing_images,
      ad_group_ad.ad.demand_gen_video_responsive_ad.videos`

const GAQL_AD_FIELDS_MEDIUM = `
      ad_group_ad.ad.image_ad.image_url,
      ad_group_ad.ad.responsive_display_ad.marketing_images,
      ad_group_ad.ad.responsive_display_ad.square_marketing_images,
      ad_group_ad.ad.responsive_display_ad.logo_images,
      ad_group_ad.ad.video_responsive_ad.videos`

/** Display + image only (no video_responsive) — some API versions reject vma fields. */
const GAQL_AD_FIELDS_LIGHT = `
      ad_group_ad.ad.image_ad.image_url,
      ad_group_ad.ad.responsive_display_ad.marketing_images,
      ad_group_ad.ad.responsive_display_ad.square_marketing_images,
      ad_group_ad.ad.responsive_display_ad.logo_images`

function buildAdGroupAdCreativeQuery(dateWhere: string, adFieldBlock: string): string {
  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      ad_group.id,
      ad_group.name,
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
${adFieldBlock}
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      segments.date
    FROM ad_group_ad
    WHERE ${dateWhere}
      AND ad_group_ad.status != 'REMOVED'
      AND campaign.status != 'REMOVED'
  `
}

async function executeAdGroupAdCreativeGaql(
  accessToken: string,
  customerId: string,
  dateWhere: string
): Promise<{ rows: unknown[]; tier: 'full' | 'medium' | 'light' | 'minimal' }> {
  const attempts: { label: 'full' | 'medium' | 'light' | 'minimal'; block: string }[] = [
    { label: 'full', block: GAQL_AD_FIELDS_FULL },
    { label: 'medium', block: GAQL_AD_FIELDS_MEDIUM },
    { label: 'light', block: GAQL_AD_FIELDS_LIGHT },
    { label: 'minimal', block: '' },
  ]
  let lastErr: Error | null = null
  for (const { label, block } of attempts) {
    const q = buildAdGroupAdCreativeQuery(dateWhere, block)
    try {
      const rows = await executeGaql(accessToken, customerId, q)
      return { rows, tier: label }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw lastErr ?? new Error('Google Ads creative query failed')
}

function headlineSnippet(
  ad?: { responsiveSearchAd?: { headlines?: Array<{ text?: string }> } } | undefined
): string | null {
  if (!ad) return null
  const h = ad.responsiveSearchAd?.headlines?.[0]?.text
  return h ? h.slice(0, 160) : null
}

function isAssetResourceName(v: unknown): v is string {
  return typeof v === 'string' && v.includes('/assets/')
}

function collectAssetRefsFromAd(ad: GaqlRow['adGroupAd'] | undefined): string[] {
  const a = ad?.ad
  if (!a) return []
  const out: string[] = []
  const add = (v: unknown) => {
    if (isAssetResourceName(v)) out.push(v)
    if (Array.isArray(v)) for (const x of v) add(x)
  }
  add(a.videoAd?.video)
  add(a.responsiveDisplayAd?.marketingImages)
  add(a.responsiveDisplayAd?.squareMarketingImages)
  add(a.responsiveDisplayAd?.logoImages)
  add(a.videoResponsiveAd?.videos)
  add(a.demandGenMultiAssetAd?.marketingImages)
  add(a.demandGenMultiAssetAd?.squareMarketingImages)
  add(a.demandGenVideoResponsiveAd?.videos)
  return [...new Set(out)]
}

function directImageUrlFromAd(ad: GaqlRow['adGroupAd'] | undefined): string | null {
  const u = ad?.ad?.imageAd?.imageUrl?.trim()
  return u || null
}

type AssetPreview = { imageUrl?: string; youtubeVideoId?: string }

async function fetchAssetPreviewMap(
  accessToken: string,
  customerId: string,
  resourceNames: string[]
): Promise<Map<string, AssetPreview>> {
  const map = new Map<string, AssetPreview>()
  const unique = [...new Set(resourceNames)].filter(Boolean)
  const CHUNK = 40
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK)
    const inList = slice.map((r) => `'${r.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(', ')
    const q = `
      SELECT
        asset.resource_name,
        asset.image_asset.full_size.url,
        asset.youtube_video_asset.youtube_video_id
      FROM asset
      WHERE asset.resource_name IN (${inList})
    `
    try {
      const assetRows = await executeGaql(accessToken, customerId, q)
      for (const raw of assetRows) {
        const row = raw as {
          asset?: {
            resourceName?: string
            imageAsset?: { fullSize?: { url?: string } }
            youtubeVideoAsset?: { youtubeVideoId?: string }
          }
        }
        const rn = row.asset?.resourceName
        if (!rn) continue
        const imageUrl = row.asset?.imageAsset?.fullSize?.url?.trim() || undefined
        const youtubeVideoId = row.asset?.youtubeVideoAsset?.youtubeVideoId?.trim() || undefined
        map.set(rn, { imageUrl, youtubeVideoId })
      }
    } catch {
      // Skip chunk on failure (invalid id, etc.)
    }
  }
  return map
}

function resolveVisualPreview(
  directImage: string | null,
  assetRefs: string[],
  assetMap: Map<string, AssetPreview>
): { previewImageUrl: string | null; previewYoutubeId: string | null } {
  if (directImage) {
    return { previewImageUrl: directImage, previewYoutubeId: null }
  }
  let previewImageUrl: string | null = null
  let previewYoutubeId: string | null = null
  for (const ref of assetRefs) {
    const p = assetMap.get(ref)
    if (p?.imageUrl && !previewImageUrl) previewImageUrl = p.imageUrl
    if (p?.youtubeVideoId && !previewYoutubeId) previewYoutubeId = p.youtubeVideoId
  }
  return { previewImageUrl, previewYoutubeId }
}

/** Field types on ad_group_ad_asset_view that carry image URLs (not headlines). */
const ASSET_VIEW_IMAGE_FIELD_TYPES = new Set([
  'MARKETING_IMAGE',
  'SQUARE_MARKETING_IMAGE',
  'PORTRAIT_MARKETING_IMAGE',
  'TALL_PORTRAIT_MARKETING_IMAGE',
  'AD_IMAGE',
  'DEMAND_GEN_CAROUSEL_CARD',
  'LOGO',
  'LANDSCAPE_LOGO',
  'BUSINESS_LOGO',
])

type AssetViewGaqlRow = {
  campaign?: { id?: string | number }
  adGroup?: { id?: string | number }
  adGroupAd?: { ad?: { id?: string | number } }
  adGroupAdAssetView?: { fieldType?: string; enabled?: boolean }
  asset?: {
    imageAsset?: { fullSize?: { url?: string } }
    youtubeVideoAsset?: { youtubeVideoId?: string }
  }
  metrics?: { impressions?: string }
}

/**
 * Demand Gen / RSA etc. often expose image & YouTube URLs here even when ad_group_ad
 * nested fields are empty (especially under compatibility-tier queries).
 */
async function fetchAdGroupAdAssetViewPreviews(
  accessToken: string,
  customerId: string,
  dateWhere: string
): Promise<Map<string, { imageUrl?: string; youtubeId?: string }>> {
  const q = `
    SELECT
      campaign.id,
      ad_group.id,
      ad_group_ad.ad.id,
      ad_group_ad_asset_view.field_type,
      asset.image_asset.full_size.url,
      asset.youtube_video_asset.youtube_video_id,
      metrics.impressions
    FROM ad_group_ad_asset_view
    WHERE ${dateWhere}
      AND ad_group_ad_asset_view.enabled = TRUE
  `
  try {
    const assetRows = await executeGaql(accessToken, customerId, q)
    const byAd = new Map<
      string,
      { imageUrl?: string; imageImpr: number; youtubeId?: string; youtubeImpr: number }
    >()

    for (const raw of assetRows) {
      const r = raw as AssetViewGaqlRow
      const cid = r.campaign?.id != null ? String(r.campaign.id) : ''
      const agid = r.adGroup?.id != null ? String(r.adGroup.id) : ''
      const aid = r.adGroupAd?.ad?.id != null ? String(r.adGroupAd.ad.id) : ''
      if (!cid || !aid) continue

      const key = `${cid}|${agid}|${aid}`
      const ft = (r.adGroupAdAssetView?.fieldType ?? '').toString()
      const impr = parseInt(r.metrics?.impressions || '0', 10) || 0
      const imgUrl = r.asset?.imageAsset?.fullSize?.url?.trim()
      const yt = r.asset?.youtubeVideoAsset?.youtubeVideoId?.trim()

      let e = byAd.get(key)
      if (!e) {
        e = { imageImpr: -1, youtubeImpr: -1 }
        byAd.set(key, e)
      }

      if (imgUrl && ASSET_VIEW_IMAGE_FIELD_TYPES.has(ft) && impr >= e.imageImpr) {
        e.imageUrl = imgUrl
        e.imageImpr = impr
      }
      if (yt && impr >= e.youtubeImpr) {
        e.youtubeId = yt
        e.youtubeImpr = impr
      }
    }

    const out = new Map<string, { imageUrl?: string; youtubeId?: string }>()
    for (const [k, v] of byAd) {
      if (v.imageUrl || v.youtubeId) {
        out.set(k, { imageUrl: v.imageUrl, youtubeId: v.youtubeId })
      }
    }
    return out
  } catch {
    return new Map()
  }
}

type PmaxAssetGaqlRow = {
  campaign?: {
    id?: string | number
    name?: string
    advertisingChannelType?: string
  }
  assetGroup?: { id?: string | number; name?: string }
  assetGroupAsset?: { asset?: string; fieldType?: string }
  metrics?: {
    impressions?: string
    clicks?: string
    costMicros?: string
    conversions?: string
    conversionsValue?: string
  }
  segments?: { date?: string }
}

function assetNumericIdFromResourceName(assetResourceName: string): string {
  const m = assetResourceName.match(/\/assets\/(\d+)/)
  return m?.[1] ?? ''
}

function humanizePmaxFieldType(fieldType: string): string {
  if (!fieldType) return 'Asset'
  return fieldType
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Performance Max does not use ad_group_ad; creatives and metrics are exposed via asset_group_asset.
 * @see https://developers.google.com/google-ads/api/performance-max/asset-reporting
 */
async function fetchPerformanceMaxAssetGroupAssetRows(
  accessToken: string,
  customerId: string,
  dateWhere: string
): Promise<unknown[]> {
  const q = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      asset_group.id,
      asset_group.name,
      asset_group_asset.asset,
      asset_group_asset.field_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      segments.date
    FROM asset_group_asset
    WHERE ${dateWhere}
      AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
      AND asset_group_asset.status != 'REMOVED'
      AND campaign.status != 'REMOVED'
  `
  try {
    return await executeGaql(accessToken, customerId, q)
  } catch {
    return []
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const days = Math.min(MAX_DAYS, Math.max(1, Number(searchParams.get('days')) || DEFAULT_DAYS))
  const intentFilter = searchParams.get('intent') || 'all'

  let since: Date
  let toDate: Date
  const fromStr = searchParams.get('from')
  const toStr = searchParams.get('to')
  if (fromStr && toStr) {
    since = new Date(`${fromStr}T00:00:00.000Z`)
    toDate = new Date(`${toStr}T23:59:59.999Z`)
    if (Number.isNaN(since.getTime()) || Number.isNaN(toDate.getTime()) || since > toDate) {
      toDate = new Date()
      since = new Date()
      since.setUTCDate(since.getUTCDate() - days)
      since.setUTCHours(0, 0, 0, 0)
    }
  } else {
    toDate = new Date()
    since = new Date()
    since.setUTCDate(since.getUTCDate() - days)
    since.setUTCHours(0, 0, 0, 0)
  }

  const spanDays =
    Math.floor((toDate.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)) + 1
  if (spanDays > MAX_DAYS) {
    const clampStart = new Date(toDate)
    clampStart.setUTCDate(clampStart.getUTCDate() - (MAX_DAYS - 1))
    clampStart.setUTCHours(0, 0, 0, 0)
    since = clampStart
  }

  const rangeFrom = since.toISOString().slice(0, 10)
  const rangeTo = toDate.toISOString().slice(0, 10)

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      features: true,
      google_ads_connections: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          refresh_token: true,
          currency: true,
          selected_customer_id: true,
          customer_ids: true,
        },
      },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const guard = featureGuard(workspace.features as any, 'google_ads')
  if (guard) return guard

  const connection = workspace.google_ads_connections
  if (!connection) {
    return NextResponse.json({
      ads: [],
      activeCustomerId: null,
      rawRowCount: 0,
      from: rangeFrom,
      to: rangeTo,
      intentFilter,
      currency: 'USD',
      note: 'No Google Ads connection.',
    })
  }

  const customerIds = connection.customer_ids ?? []
  const customerId =
    connection.selected_customer_id ??
    (customerIds.length >= 1 ? customerIds[0] : null)

  if (!customerId) {
    return NextResponse.json({
      ads: [],
      activeCustomerId: null,
      rawRowCount: 0,
      from: rangeFrom,
      to: rangeTo,
      intentFilter,
      currency: connection.currency ?? 'USD',
      note: 'Select a Google Ads account on the Dashboard.',
    })
  }

  const intentMap = await loadCampaignIntentMap(prisma, workspace.id)

  const dateWhere = buildDateRangeWhere(rangeFrom, rangeTo)

  let rows: unknown[]
  let accessToken: string
  let creativeQueryTier: 'full' | 'medium' | 'light' | 'minimal' = 'full'
  try {
    const tok = await refreshGoogleAccessToken(connection.refresh_token)
    accessToken = tok.accessToken
    const result = await executeAdGroupAdCreativeGaql(accessToken, customerId, dateWhere)
    rows = result.rows
    creativeQueryTier = result.tier
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `Google Ads creative query failed: ${msg}` },
      { status: 502 }
    )
  }

  type Agg = {
    campaignId: string
    campaignName: string
    channelType: string
    adGroupId: string
    adGroupName: string
    adId: string
    adName: string
    adType: string
    previewText: string | null
    landingUrl: string | null
    directImageUrl: string | null
    assetResourceNames: Set<string>
    impressions: number
    clicks: number
    spend: number
    conversions: number
    conversionValue: number
  }

  const byKey = new Map<string, Agg>()

  for (const raw of rows) {
    const r = raw as GaqlRow
    const cid = r.campaign?.id != null ? String(r.campaign.id) : ''
    const agid = r.adGroup?.id != null ? String(r.adGroup.id) : ''
    const aid = r.adGroupAd?.ad?.id != null ? String(r.adGroupAd.ad.id) : ''
    if (!cid || !aid) continue

    const key = `${cid}|${agid}|${aid}`
    const impr = parseInt(r.metrics?.impressions || '0', 10) || 0
    const clk = parseInt(r.metrics?.clicks || '0', 10) || 0
    const spend = (parseInt(r.metrics?.costMicros || '0', 10) || 0) / 1_000_000
    const conv = parseFloat(r.metrics?.conversions || '0') || 0
    const cval = parseFloat(r.metrics?.conversionsValue || '0') || 0

    const ad = r.adGroupAd?.ad
    const preview = headlineSnippet(ad)
    const landing = ad?.finalUrls?.[0] ?? null
    const adType = ad?.type ?? 'UNKNOWN'
    const adName = ad?.name?.trim() || ''
    const channelType = r.campaign?.advertisingChannelType ?? 'UNKNOWN'
    const dirImg = directImageUrlFromAd(r.adGroupAd)
    const assetRefs = collectAssetRefsFromAd(r.adGroupAd)

    let e = byKey.get(key)
    if (!e) {
      e = {
        campaignId: cid,
        campaignName: r.campaign?.name ?? '',
        channelType,
        adGroupId: agid,
        adGroupName: r.adGroup?.name ?? '',
        adId: aid,
        adName,
        adType,
        previewText: preview,
        landingUrl: landing,
        directImageUrl: dirImg,
        assetResourceNames: new Set(assetRefs),
        impressions: 0,
        clicks: 0,
        spend: 0,
        conversions: 0,
        conversionValue: 0,
      }
      byKey.set(key, e)
    }
    e.impressions += impr
    e.clicks += clk
    e.spend += spend
    e.conversions += conv
    e.conversionValue += cval
    e.campaignName = r.campaign?.name ?? e.campaignName
    e.adGroupName = r.adGroup?.name ?? e.adGroupName
    e.channelType = channelType
    if (adName) e.adName = adName
    if (preview && !e.previewText) e.previewText = preview
    if (landing && !e.landingUrl) e.landingUrl = landing
    if (dirImg && !e.directImageUrl) e.directImageUrl = dirImg
    for (const ref of assetRefs) e.assetResourceNames.add(ref)
  }

  const pmaxRows = await fetchPerformanceMaxAssetGroupAssetRows(
    accessToken,
    customerId,
    dateWhere
  )

  for (const raw of pmaxRows) {
    const r = raw as PmaxAssetGaqlRow
    const cid = r.campaign?.id != null ? String(r.campaign.id) : ''
    const agid = r.assetGroup?.id != null ? String(r.assetGroup.id) : ''
    const assetRn = r.assetGroupAsset?.asset?.trim() ?? ''
    if (!cid || !agid || !assetRn) continue

    const aid = assetNumericIdFromResourceName(assetRn) || assetRn.split('/').pop() || assetRn
    const key = `pmax|${cid}|${agid}|${assetRn}`
    const impr = parseInt(r.metrics?.impressions || '0', 10) || 0
    const clk = parseInt(r.metrics?.clicks || '0', 10) || 0
    const spend = (parseInt(r.metrics?.costMicros || '0', 10) || 0) / 1_000_000
    const conv = parseFloat(r.metrics?.conversions || '0') || 0
    const cval = parseFloat(r.metrics?.conversionsValue || '0') || 0
    const fieldType = (r.assetGroupAsset?.fieldType ?? '').toString()
    const agName = r.assetGroup?.name?.trim() ?? ''
    const ftLabel = humanizePmaxFieldType(fieldType)

    let e = byKey.get(key)
    if (!e) {
      e = {
        campaignId: cid,
        campaignName: r.campaign?.name ?? '',
        channelType: r.campaign?.advertisingChannelType ?? 'PERFORMANCE_MAX',
        adGroupId: agid,
        adGroupName: agName,
        adId: aid,
        adName: agName && ftLabel !== 'Asset' ? `${agName} · ${ftLabel}` : agName || ftLabel || aid,
        adType: 'PERFORMANCE_MAX',
        previewText: ftLabel !== 'Asset' ? ftLabel : null,
        landingUrl: null,
        directImageUrl: null,
        assetResourceNames: new Set([assetRn]),
        impressions: 0,
        clicks: 0,
        spend: 0,
        conversions: 0,
        conversionValue: 0,
      }
      byKey.set(key, e)
    }
    e.impressions += impr
    e.clicks += clk
    e.spend += spend
    e.conversions += conv
    e.conversionValue += cval
    e.campaignName = r.campaign?.name ?? e.campaignName
    e.adGroupName = agName || e.adGroupName
    e.channelType = r.campaign?.advertisingChannelType ?? e.channelType
    e.assetResourceNames.add(assetRn)
  }

  const allAssetRefs: string[] = []
  for (const e of byKey.values()) {
    e.assetResourceNames.forEach((r) => allAssetRefs.push(r))
  }
  const assetMap = await fetchAssetPreviewMap(accessToken, customerId, allAssetRefs)
  const assetViewByAd = await fetchAdGroupAdAssetViewPreviews(
    accessToken,
    customerId,
    dateWhere
  )

  const ads = Array.from(byKey.values())
    .map((e) => {
      const intent = resolveCampaignIntent(intentMap, 'google', e.campaignId)
      const ctrPct = e.impressions > 0 ? (e.clicks / e.impressions) * 100 : 0
      const roas = e.spend > 0 ? e.conversionValue / e.spend : 0
      const refs = [...e.assetResourceNames]
      let { previewImageUrl, previewYoutubeId } = resolveVisualPreview(
        e.directImageUrl,
        refs,
        assetMap
      )
      const avKey = `${e.campaignId}|${e.adGroupId}|${e.adId}`
      const av = assetViewByAd.get(avKey)
      if (av?.imageUrl && !previewImageUrl) previewImageUrl = av.imageUrl
      if (av?.youtubeId && !previewYoutubeId) previewYoutubeId = av.youtubeId
      return {
        adId: e.adId,
        adName: e.adName,
        adType: e.adType,
        previewText: e.previewText,
        previewImageUrl,
        previewYoutubeId,
        landingUrl: e.landingUrl,
        campaignId: e.campaignId,
        campaignName: e.campaignName,
        channelType: e.channelType,
        adGroupId: e.adGroupId,
        adGroupName: e.adGroupName,
        intent,
        impressions: e.impressions,
        clicks: e.clicks,
        spend: e.spend,
        conversions: e.conversions,
        conversionValue: e.conversionValue,
        ctrPct: Math.round(ctrPct * 100) / 100,
        roas: Math.round(roas * 100) / 100,
      }
    })
    .filter((m) => matchesIntentFilter(m.intent, intentFilter))
    .sort((a, b) => b.spend - a.spend)

  let note: string | undefined
  if (rows.length === 0 && pmaxRows.length === 0) {
    note =
      'No creative rows in this range. Confirm the account has serving ads (Search/Display/Demand Gen) or Performance Max asset groups for these dates.'
  } else if (ads.length === 0 && (rows.length > 0 || pmaxRows.length > 0)) {
    note = 'All ads were filtered out by intent. Try “All intents”.'
  }

  const hint =
    'Search/Display/Demand Gen use ad_group_ad plus ad_group_ad_asset_view. Performance Max uses asset_group_asset (one row per asset in an asset group). Asset image/video URLs come from the asset resource when Google returns them; some text-only asset types have no preview image.' +
    (creativeQueryTier !== 'full'
      ? ` Query ran in “${creativeQueryTier}” compatibility mode (narrower ad fields). Set GOOGLE_ADS_API_VERSION to v22+ in .env for Demand Gen / legacy video paths.`
      : '')

  return NextResponse.json({
    ads,
    activeCustomerId: customerId,
    rawRowCount: rows.length + pmaxRows.length,
    creativeQueryTier,
    from: rangeFrom,
    to: rangeTo,
    intentFilter,
    currency: connection.currency ?? 'USD',
    note,
    hint,
  })
}
