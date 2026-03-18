/**
 * Klaviyo REST API (revision 2025-10-15).
 * Campaign / flow reporting uses JSON:API shapes; we parse flexibly.
 */

const KLAVIYO_BASE = 'https://a.klaviyo.com/api'
const REVISION = '2025-10-15'

export type KlaviyoCampaignRow = {
  id: string
  name: string
  sendTime: string | null
  channel: 'email' | 'sms'
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function klaviyoRequest<T>(
  apiKey: string,
  path: string,
  init?: RequestInit & { retryOn429?: boolean }
): Promise<T> {
  const url = path.startsWith('http') ? path : `${KLAVIYO_BASE}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      revision: REVISION,
      ...(init?.headers as Record<string, string>),
    },
  })
  if (res.status === 429 && init?.retryOn429 !== false) {
    await sleep(35000)
    return klaviyoRequest(apiKey, path, { ...init, retryOn429: false })
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Klaviyo ${res.status}: ${text.slice(0, 400)}`)
  }
  return res.json() as Promise<T>
}

/** Validate key (accounts or campaigns list). */
export async function klaviyoValidateApiKey(apiKey: string): Promise<void> {
  try {
    await klaviyoRequest(apiKey, '/accounts/?page[size]=1', { method: 'GET' })
  } catch {
    await klaviyoRequest(apiKey, '/campaigns/?page[size]=1', { method: 'GET' })
  }
}

export async function klaviyoFindPlacedOrderMetricId(apiKey: string): Promise<string | null> {
  const filters = [
    encodeURIComponent('equals(name,"Placed Order")'),
    encodeURIComponent('equals(name,"Placed order")'),
  ]
  for (const enc of filters) {
    const j = await klaviyoRequest<{ data?: { id: string }[] }>(
      apiKey,
      `/metrics/?filter=${enc}&page[size]=5`,
      { method: 'GET' }
    )
    if (j.data?.[0]?.id) return j.data[0].id
  }
  return null
}

function inferChannel(c: Record<string, unknown>): 'email' | 'sms' {
  const ch = String(c.channel ?? c.send_channel ?? '').toLowerCase()
  if (ch.includes('sms')) return 'sms'
  return 'email'
}

export async function klaviyoListCampaignsSince(
  apiKey: string,
  sinceIso: string,
  maxPages = 25
): Promise<KlaviyoCampaignRow[]> {
  const filter = encodeURIComponent(`greater-or-equal(send_time,${sinceIso})`)
  const out: KlaviyoCampaignRow[] = []
  let next: string | null =
    `/campaigns/?filter=${filter}&page[size]=100&sort=-send_time`

  for (let p = 0; p < maxPages && next; p++) {
    type Page = {
      data?: { id: string; attributes?: Record<string, unknown> }[]
      links?: { next?: string | null }
    }
    const j: Page = await klaviyoRequest<Page>(apiKey, next, { method: 'GET' })
    for (const row of j.data ?? []) {
      const a = row.attributes ?? {}
      const st = a.send_time as string | undefined
      if (!st) continue
      out.push({
        id: row.id,
        name: String(a.name ?? 'Campaign'),
        sendTime: st,
        channel: inferChannel(a),
      })
    }
    const nxt: string | null | undefined = j.links?.next
    next =
      nxt && nxt.includes('a.klaviyo.com')
        ? nxt.replace(/^https:\/\/a\.klaviyo\.com\/api/, '')
        : null
    await sleep(1200)
  }
  return out
}

/** Normalize statistic keys from Klaviyo (snake / human labels) */
function num(v: unknown): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export type CampaignStats = {
  delivered: number
  uniqueOpens: number
  uniqueClicks: number
  orders: number
  revenue: number
  unsubscribes: number
  spamComplaints: number
}

function pickStats(raw: Record<string, unknown>): CampaignStats {
  const d = (k: string) => num(raw[k] ?? raw[k.replace(/_/g, ' ')] ?? (raw as any)[k])
  return {
    delivered: d('delivered') || d('recipients'),
    uniqueOpens: d('opens_unique') || d('unique_opens') || d('opened'),
    uniqueClicks: d('clicks_unique') || d('unique_clicks') || d('clicked'),
    orders: d('conversions') || d('placed_order') || d('orders'),
    revenue: d('conversion_value') || d('revenue') || d('placed_order_value'),
    unsubscribes: d('unsubscribe_uniques') || d('unsubscribes'),
    spamComplaints: d('spam_complaints') || d('spam_complaint_count'),
  }
}

/**
 * Campaign values for a set of campaign IDs (Klaviyo filter).
 * Rate limits: ~2/min steady — caller should throttle.
 */
export async function klaviyoCampaignValuesForIds(
  apiKey: string,
  campaignIds: string[],
  conversionMetricId: string
): Promise<Map<string, CampaignStats>> {
  const map = new Map<string, CampaignStats>()
  if (campaignIds.length === 0) return map

  const idList = campaignIds.map((id) => `"${id}"`).join(',')
  const filterStr = `contains-any(campaign_id,[${idList}])`

  const body = {
    data: {
      type: 'campaign-values-report',
      attributes: {
        statistics: [
          'delivered',
          'opens_unique',
          'clicks_unique',
          'conversions',
          'conversion_value',
          'unsubscribe_uniques',
          'spam_complaints',
        ],
        timeframe: { key: 'last_365_days' },
        conversion_metric_id: conversionMetricId,
        filter: filterStr,
      },
    },
  }

  let j: Record<string, unknown>
  try {
    j = await klaviyoRequest<Record<string, unknown>>(apiKey, '/campaign-values-reports/', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  } catch {
    return map
  }

  const data = j.data as Record<string, unknown> | undefined
  const attrs = (data?.attributes ?? j) as Record<string, unknown>
  const results = (attrs.results ?? attrs.data ?? []) as unknown[]
  for (const row of results) {
    const r = row as Record<string, unknown>
    const g = (r.groupings ?? r.grouping ?? {}) as Record<string, unknown>
    const cid = String(g.campaign_id ?? g.campaignId ?? r.campaign_id ?? '')
    const stats = (r.statistics ?? r) as Record<string, unknown>
    if (cid) map.set(cid, pickStats(stats))
  }
  return map
}

export type FlowDailyPoint = {
  flowId: string
  flowName: string
  date: string
  channel: 'email' | 'sms'
  stats: CampaignStats
}

/**
 * Daily flow performance (email channel). One series request per sync.
 */
export async function klaviyoFlowSeriesDaily(
  apiKey: string,
  startDate: string,
  endDate: string,
  conversionMetricId: string,
  sendChannel: 'email' | 'sms' = 'email'
): Promise<FlowDailyPoint[]> {
  const filter =
    sendChannel === 'sms' ? "equals(send_channel,'sms')" : "equals(send_channel,'email')"
  const body = {
    data: {
      type: 'flow-series-report',
      attributes: {
        statistics: [
          'delivered',
          'opens_unique',
          'clicks_unique',
          'conversions',
          'conversion_value',
          'unsubscribe_uniques',
          'spam_complaints',
        ],
        timeframe: {
          start: `${startDate}T00:00:00Z`,
          end: `${endDate}T23:59:59Z`,
        },
        interval: 'daily',
        conversion_metric_id: conversionMetricId,
        filter,
      },
    },
  }

  let j: Record<string, unknown>
  try {
    j = await klaviyoRequest<Record<string, unknown>>(apiKey, '/flow-series-reports/', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  } catch {
    return []
  }

  const data = j.data as Record<string, unknown> | undefined
  const attrs = (data?.attributes ?? j) as Record<string, unknown>
  const results = (attrs.results ?? []) as unknown[]
  const points: FlowDailyPoint[] = []

  for (const row of results) {
    const r = row as Record<string, unknown>
    const g = (r.groupings ?? {}) as Record<string, unknown>
    const flowId = String(g.flow_id ?? g.flowId ?? '')
    const flowName = String(g.flow_name ?? g.name ?? 'Flow')
    const dates = (r.dates ?? r.date_times ?? []) as string[]
    const statsArr = (r.statistics ?? []) as Record<string, unknown>[]
    if (!flowId || !Array.isArray(dates)) continue
    for (let i = 0; i < dates.length; i++) {
      const stat = (statsArr[i] ?? r) as Record<string, unknown>
      const dateStr = String(dates[i] ?? '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue
      points.push({
        flowId,
        flowName,
        date: dateStr,
        channel: sendChannel,
        stats: pickStats(stat),
      })
    }
  }
  return points
}
