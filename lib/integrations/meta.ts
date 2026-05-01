import crypto from 'crypto'

const META_APP_ID = process.env.META_APP_ID!
const META_APP_SECRET = process.env.META_APP_SECRET!
const META_REDIRECT_URI = process.env.META_REDIRECT_URI!
const META_API_VERSION = process.env.META_API_VERSION || 'v21.0'
const META_CONFIG_ID = process.env.META_CONFIG_ID || ''

const META_SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'read_insights',
].join(',')

export function buildMetaAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: META_REDIRECT_URI,
    state,
    scope: META_SCOPES,
    response_type: 'code',
  })
  if (META_CONFIG_ID) {
    params.set('config_id', META_CONFIG_ID)
  }
  return `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}`
}

export function appsecretProof(accessToken: string): string {
  const secret = process.env.META_APP_SECRET
  if (!secret || typeof secret !== 'string') {
    throw new Error(
      'META_APP_SECRET is not set. Add it to your .env to sync Meta Ads (used for appsecret_proof).'
    )
  }
  return crypto
    .createHmac('sha256', secret)
    .update(accessToken)
    .digest('hex')
}

export async function exchangeMetaCode(
  code: string
): Promise<{ accessToken: string; expiresIn?: number }> {
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    redirect_uri: META_REDIRECT_URI,
    code,
  })

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?${params.toString()}`
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meta token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  }
}

export async function exchangeForLongLivedToken(
  shortToken: string
): Promise<{ accessToken: string; expiresIn?: number }> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    fb_exchange_token: shortToken,
  })

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?${params.toString()}`
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meta long-lived token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  }
}

export async function fetchMetaAdAccounts(
  accessToken: string
): Promise<{ id: string; name: string; accountId: string }[]> {
  const proof = appsecretProof(accessToken)
  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts?fields=id,name,account_id&access_token=${accessToken}&appsecret_proof=${proof}&limit=100`
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to fetch Meta ad accounts (${res.status}): ${text}`)
  }

  const data = await res.json()
  return (data.data || []).map((a: { id: string; name: string; account_id: string }) => ({
    id: a.id,
    name: a.name,
    accountId: a.account_id,
  }))
}

export async function fetchMetaAdAccountNames(
  accessToken: string,
  adAccountIds: string[]
): Promise<Record<string, string>> {
  if (adAccountIds.length === 0) return {}
  const accounts = await fetchMetaAdAccounts(accessToken)
  const namesById: Record<string, string> = {}
  const wanted = new Set(adAccountIds)
  for (const account of accounts) {
    if (!wanted.has(account.id)) continue
    const name = account.name?.trim()
    if (name) namesById[account.id] = name
  }
  return namesById
}

export async function fetchMetaUserId(
  accessToken: string
): Promise<string> {
  const proof = appsecretProof(accessToken)
  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/me?fields=id&access_token=${accessToken}&appsecret_proof=${proof}`
  )
  if (!res.ok) throw new Error('Failed to fetch Meta user ID')
  const data = await res.json()
  return data.id
}

export async function fetchMetaAdAccountCurrency(
  accessToken: string,
  adAccountId: string
): Promise<string | null> {
  const proof = appsecretProof(accessToken)
  const normalizedId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
  const url =
    `https://graph.facebook.com/${META_API_VERSION}/${normalizedId}` +
    `?fields=name,currency,account_status&access_token=${accessToken}&appsecret_proof=${proof}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = (await res.json()) as { currency?: unknown }
  if (typeof data.currency !== 'string' || !data.currency.trim()) return null
  return data.currency.trim().toUpperCase()
}

const META_RATE_LIMIT_RETRIES = 3
const META_RATE_LIMIT_BACKOFF_MS = 2000

/**
 * Fetch daily insights for an ad account.
 * Uses explicit time_range: { since, until } and time_increment=1 for daily rows.
 */
export async function fetchAdAccountInsights(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<MetaInsightRow[]> {
  const proof = appsecretProof(accessToken)
  const fields = 'campaign_id,campaign_name,adset_id,adset_name,impressions,clicks,spend,actions,action_values,ctr,cpc,cpm'
  const rows: MetaInsightRow[] = []

  let url: string | null =
    `https://graph.facebook.com/${META_API_VERSION}/${adAccountId}/insights?` +
    new URLSearchParams({
      fields,
      time_range: JSON.stringify({ since, until }),
      time_increment: '1',
      level: 'campaign',
      limit: '500',
      access_token: accessToken,
      appsecret_proof: proof,
    }).toString()

  while (url) {
    let res: Response = await fetch(url)
    for (let attempt = 0; res.status === 429 && attempt < META_RATE_LIMIT_RETRIES; attempt++) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Meta Ads] Rate limited (429), backoff ${META_RATE_LIMIT_BACKOFF_MS}ms attempt ${attempt + 1}`)
      }
      await new Promise((r) => setTimeout(r, META_RATE_LIMIT_BACKOFF_MS * (attempt + 1)))
      res = await fetch(url)
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Meta insights fetch failed (${res.status}): ${text}`)
    }
    const data = await res.json()

    for (const row of data.data || []) {
      const conversions = parseActionsCount(row.actions, 'offsite_conversion.fb_pixel_purchase')
      const revenue = parseActionsValue(row.action_values, 'offsite_conversion.fb_pixel_purchase')

      rows.push({
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        adsetId: row.adset_id || null,
        adsetName: row.adset_name || null,
        date: row.date_start,
        impressions: parseInt(row.impressions || '0', 10),
        clicks: parseInt(row.clicks || '0', 10),
        spend: parseFloat(row.spend || '0'),
        conversions,
        revenue,
        ctr: parseFloat(row.ctr || '0'),
        cpc: parseFloat(row.cpc || '0'),
        cpm: parseFloat(row.cpm || '0'),
        rawJson: row,
      })
    }

    url = data.paging?.next || null
  }

  return rows
}

function parseActionsCount(
  actions: { action_type: string; value: string }[] | undefined,
  type: string
): number {
  if (!actions) return 0
  const found = actions.find((a) => a.action_type === type)
  return found ? parseInt(found.value, 10) : 0
}

function parseActionsValue(
  actionValues: { action_type: string; value: string }[] | undefined,
  type: string
): number {
  if (!actionValues) return 0
  const found = actionValues.find((a) => a.action_type === type)
  return found ? parseFloat(found.value) : 0
}

/** Sum `value` across Meta insight action arrays (e.g. video_p25_watched_actions). */
export function sumMetaInsightActionValues(val: unknown): number {
  if (val == null) return 0
  if (typeof val === 'number' && !Number.isNaN(val)) return val
  if (typeof val === 'string') return parseFloat(val) || 0
  if (!Array.isArray(val)) return 0
  let s = 0
  for (const x of val) {
    if (x && typeof x === 'object' && 'value' in x) {
      s += parseFloat(String((x as { value: string }).value)) || 0
    }
  }
  return s
}

function firstMetaInsightMetricValue(val: unknown): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val
  if (typeof val === 'string') return parseFloat(val) || 0
  if (Array.isArray(val) && val.length > 0) {
    const x = val[0] as { value?: string }
    if (x && 'value' in x) return parseFloat(String(x.value)) || 0
  }
  return 0
}

export type MetaAdCreativeInsightRow = {
  adId: string
  adName: string
  campaignId: string
  campaignName: string
  adsetId: string | null
  adsetName: string | null
  date: string
  impressions: number
  clicks: number
  spend: number
  /** 3s views from actions (3_second_video_view etc.); null if Meta omitted those action types */
  video3s: number | null
  thruplay: number
  avgWatchSec: number
  p25: number
  p50: number
  p75: number
  p95: number
  conversions: number
  revenue: number
  rawJson: unknown
}

const AD_INSIGHT_BASE_FIELDS = [
  'ad_id',
  'ad_name',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'impressions',
  'clicks',
  'spend',
  'actions',
  'action_values',
] as const

/** Optional at ad level; stripped automatically on (#100) invalid field errors */
const AD_INSIGHT_VIDEO_FIELDS = [
  'video_thruplay_watched_actions',
  'video_avg_time_watched_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
] as const

/**
 * Parse field names Meta rejects from 400 error body.
 * e.g. "(#100) video_x, video_y are not valid for fields param"
 */
export function parseInvalidMetaInsightFields(errorBody: string): string[] {
  const out: string[] = []
  const multi = errorBody.match(/\(#\d+\)\s*([\s\S]*?)\s+are not valid for fields param/i)
  if (multi) {
    const part = multi[1].replace(/\s+/g, ' ').trim()
    for (const chunk of part.split(',')) {
      const f = chunk.trim()
      if (f) out.push(f)
    }
    return out
  }
  const single = errorBody.match(/\(#\d+\)\s*(\S+)\s+is not valid for fields param/i)
  if (single?.[1]) return [single[1].trim()]
  return []
}

/**
 * 3-second views: top-level video_3_sec_* invalid at ad level; use actions only.
 * Returns null if Meta did not return any matching action type (hook rate N/A).
 */
export function parseVideo3sViewsFromActions(
  actions: { action_type: string; value: string }[] | undefined
): number | null {
  if (!actions?.length) return null
  const keys = new Set(['3_second_video_view', 'video_continuous_3_sec_watched'])
  let sum = 0
  let matched = false
  for (const a of actions) {
    if (keys.has(a.action_type)) {
      matched = true
      sum += parseInt(a.value, 10) || 0
    }
  }
  return matched ? sum : null
}

/**
 * Ad-level daily insights. level=ad, time_increment=1.
 * Drops invalid fields from the request and retries so sync still stores partial video metrics.
 * Hook / 3s: from actions (3_second_video_view) when present; video3s null otherwise.
 */
export async function fetchAdAccountAdInsights(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<MetaAdCreativeInsightRow[]> {
  const proof = appsecretProof(accessToken)
  let fields = [...AD_INSIGHT_BASE_FIELDS, ...AD_INSIGHT_VIDEO_FIELDS]
  const parsedRows: MetaAdCreativeInsightRow[] = []

  for (let guard = 0; guard < 20; guard++) {
    const fieldStr = fields.join(',')
    parsedRows.length = 0
    let url: string | null =
      `https://graph.facebook.com/${META_API_VERSION}/${adAccountId}/insights?` +
      new URLSearchParams({
        fields: fieldStr,
        time_range: JSON.stringify({ since, until }),
        time_increment: '1',
        level: 'ad',
        limit: '500',
        access_token: accessToken,
        appsecret_proof: proof,
      }).toString()

    let pageError: string | null = null
    let pageStatus = 0

    while (url) {
      let res: Response = await fetch(url)
      for (let attempt = 0; res.status === 429 && attempt < META_RATE_LIMIT_RETRIES; attempt++) {
        await new Promise((r) => setTimeout(r, META_RATE_LIMIT_BACKOFF_MS * (attempt + 1)))
        res = await fetch(url)
      }
      if (!res.ok) {
        const text = await res.text()
        pageStatus = res.status
        pageError = text
        break
      }
      const data = await res.json()

      for (const row of data.data || []) {
        const actions = row.actions as { action_type: string; value: string }[] | undefined
        const video3s = parseVideo3sViewsFromActions(actions)
        const thruplay = sumMetaInsightActionValues(row.video_thruplay_watched_actions)
        const avgWatchSec = firstMetaInsightMetricValue(row.video_avg_time_watched_actions)

        parsedRows.push({
          adId: String(row.ad_id ?? ''),
          adName: String(row.ad_name ?? ''),
          campaignId: String(row.campaign_id ?? ''),
          campaignName: String(row.campaign_name ?? ''),
          adsetId: row.adset_id ? String(row.adset_id) : null,
          adsetName: row.adset_name ? String(row.adset_name) : null,
          date: row.date_start || row.date_stop || since,
          impressions: parseInt(row.impressions || '0', 10),
          clicks: parseInt(row.clicks || '0', 10),
          spend: parseFloat(row.spend || '0'),
          video3s,
          thruplay: Math.round(thruplay),
          avgWatchSec,
          p25: Math.round(sumMetaInsightActionValues(row.video_p25_watched_actions)),
          p50: Math.round(sumMetaInsightActionValues(row.video_p50_watched_actions)),
          p75: Math.round(sumMetaInsightActionValues(row.video_p75_watched_actions)),
          p95: Math.round(sumMetaInsightActionValues(row.video_p95_watched_actions)),
          conversions: parseActionsCount(actions, 'offsite_conversion.fb_pixel_purchase'),
          revenue: parseActionsValue(
            row.action_values as { action_type: string; value: string }[] | undefined,
            'offsite_conversion.fb_pixel_purchase'
          ),
          rawJson: row,
        })
      }
      url = data.paging?.next || null
    }

    if (!pageError) {
      return parsedRows
    }

    if (pageStatus === 400 && pageError) {
      const invalid = parseInvalidMetaInsightFields(pageError)
      if (invalid.length > 0) {
        const next = fields.filter((f) => !invalid.includes(f))
        if (next.length < fields.length && next.length >= AD_INSIGHT_BASE_FIELDS.length) {
          fields = next
          continue
        }
      }
    }

    throw new Error(`Meta ad insights fetch failed (${pageStatus}): ${pageError}`)
  }

  throw new Error('Meta ad insights: exceeded field fallback retries')
}

/** Parse AdCreative / object_story_spec for a displayable image URL and Facebook video id. */
export function extractMetaCreativePreview(creative: unknown): {
  imageUrl: string | null
  videoId: string | null
} {
  if (!creative || typeof creative !== 'object') return { imageUrl: null, videoId: null }
  const c = creative as Record<string, unknown>
  const thumb = typeof c.thumbnail_url === 'string' ? c.thumbnail_url.trim() : ''
  const img = typeof c.image_url === 'string' ? c.image_url.trim() : ''
  let videoId = c.video_id != null ? String(c.video_id).trim() : ''
  let imageUrl = (thumb || img || '').trim() || null

  const oss = c.object_story_spec
  if (oss && typeof oss === 'object') {
    const spec = oss as Record<string, unknown>
    const linkData = spec.link_data
    if (linkData && typeof linkData === 'object') {
      const pic = (linkData as Record<string, unknown>).picture
      if (!imageUrl && typeof pic === 'string' && pic.trim()) imageUrl = pic.trim()
    }
    const videoData = spec.video_data
    if (videoData && typeof videoData === 'object') {
      const vd = videoData as Record<string, unknown>
      const vi = vd.video_id
      if (!videoId && vi != null) videoId = String(vi).trim()
      const viu = vd.image_url
      if (!imageUrl && typeof viu === 'string' && viu.trim()) imageUrl = viu.trim()
    }
  }

  return {
    imageUrl: imageUrl || null,
    videoId: videoId || null,
  }
}

export type MetaAdCreativePreview = {
  previewImageUrl: string | null
  previewVideoId: string | null
}

const META_AD_CREATIVE_PREVIEW_CHUNK = 45

/**
 * Batch-read Ad nodes with creative fields (Graph `?ids=ad1,ad2`).
 * Falls back to narrower field sets if Meta rejects nested `object_story_spec`.
 */
export async function fetchMetaAdCreativePreviews(
  accessToken: string,
  adIds: string[]
): Promise<Map<string, MetaAdCreativePreview>> {
  const out = new Map<string, MetaAdCreativePreview>()
  const unique = [...new Set(adIds.map((id) => String(id).trim()).filter(Boolean))]
  if (unique.length === 0) return out

  const proof = appsecretProof(accessToken)
  const fieldAttempts = [
    'creative{thumbnail_url,image_url,video_id,object_story_spec}',
    'creative{thumbnail_url,image_url,video_id}',
    'creative{thumbnail_url,video_id}',
  ]

  for (let i = 0; i < unique.length; i += META_AD_CREATIVE_PREVIEW_CHUNK) {
    const slice = unique.slice(i, i + META_AD_CREATIVE_PREVIEW_CHUNK)
    const idsParam = slice.join(',')

    let gotChunk = false
    for (const creativeFields of fieldAttempts) {
      const url =
        `https://graph.facebook.com/${META_API_VERSION}/?` +
        new URLSearchParams({
          ids: idsParam,
          fields: `id,${creativeFields}`,
          access_token: accessToken,
          appsecret_proof: proof,
        }).toString()

      let res: Response
      try {
        res = await fetch(url)
      } catch {
        continue
      }
      if (!res.ok) continue

      let data: Record<string, unknown>
      try {
        data = (await res.json()) as Record<string, unknown>
      } catch {
        continue
      }
      if (data.error) continue

      for (const adId of slice) {
        const node = data[adId]
        if (!node || typeof node !== 'object') {
          out.set(adId, { previewImageUrl: null, previewVideoId: null })
          continue
        }
        const cr = (node as Record<string, unknown>).creative
        const { imageUrl, videoId } = extractMetaCreativePreview(cr)
        out.set(adId, {
          previewImageUrl: imageUrl,
          previewVideoId: videoId || null,
        })
      }
      gotChunk = true
      break
    }

    if (!gotChunk) {
      for (const adId of slice) {
        out.set(adId, { previewImageUrl: null, previewVideoId: null })
      }
    }
  }

  return out
}

export type MetaInsightRow = {
  campaignId: string
  campaignName: string
  adsetId: string | null
  adsetName: string | null
  date: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  revenue: number
  ctr: number
  cpc: number
  cpm: number
  rawJson: unknown
}
