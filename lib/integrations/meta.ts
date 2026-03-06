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
