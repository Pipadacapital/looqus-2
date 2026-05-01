const GOOGLE_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID!
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET!
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_ADS_REDIRECT_URI!
const GOOGLE_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!
const GOOGLE_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23'
const GOOGLE_LOGIN_CUSTOMER_ID = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || ''

const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/adwords'

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGoogleCode(
  code: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  if (!data.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Re-authorize with prompt=consent.'
    )
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}

export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google token refresh failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

export async function listAccessibleCustomers(
  accessToken: string
): Promise<string[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
  }
  if (GOOGLE_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = GOOGLE_LOGIN_CUSTOMER_ID
  }

  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_API_VERSION}/customers:listAccessibleCustomers`,
    { headers }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google listAccessibleCustomers failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  return (data.resourceNames || []).map((rn: string) =>
    rn.replace('customers/', '')
  )
}

/**
 * Fallback: list child accounts under a manager (MCC) account via GAQL.
 */
export async function listManagerChildAccounts(
  accessToken: string,
  managerCustomerId: string
): Promise<string[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
    'login-customer-id': managerCustomerId,
  }

  const query =
    'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager FROM customer_client WHERE customer_client.status = "ENABLED"'

  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_API_VERSION}/customers/${managerCustomerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Ads MCC child listing failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  const ids: string[] = []
  for (const batch of data) {
    for (const row of batch.results || []) {
      const id = row.customerClient?.id
      if (id) ids.push(String(id))
    }
  }
  return ids
}

export async function fetchGoogleUserEmail(
  accessToken: string
): Promise<string | null> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.email || null
  } catch {
    return null
  }
}

/**
 * Execute a GAQL query against a customer ID.
 */
export async function executeGaql(
  accessToken: string,
  customerId: string,
  query: string
): Promise<unknown[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  }
  if (GOOGLE_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = GOOGLE_LOGIN_CUSTOMER_ID
  }

  const rows: unknown[] = []
  let pageToken: string | undefined

  do {
    const body: Record<string, string> = { query }
    if (pageToken) body.pageToken = pageToken

    const res = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_API_VERSION}/customers/${customerId}/googleAds:searchStream`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }
    )

    if (!res.ok) {
      const text = await res.text()
      throw new Error(
        `Google Ads GAQL query failed (${res.status}): ${text}`
      )
    }

    const data = await res.json()
    for (const batch of data) {
      if (batch.results) rows.push(...batch.results)
    }

    pageToken = undefined // searchStream doesn't paginate the same way
  } while (false)

  return rows
}

export type GoogleAdsMetricRow = {
  customerId: string
  campaignId: string
  campaignName: string
  adGroupId: string | null
  adGroupName: string | null
  date: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  conversionValue: number
  ctr: number
  averageCpc: number
  rawJson: unknown
}

export async function fetchGoogleCustomerCurrency(
  accessToken: string,
  customerId: string
): Promise<string | null> {
  const query = `SELECT customer.id, customer.currency_code, customer.time_zone FROM customer LIMIT 1`
  const rows = await executeGaql(accessToken, customerId, query)
  const first = (rows[0] as { customer?: { currencyCode?: unknown; currency_code?: unknown } } | undefined)
    ?.customer
  const currency =
    (typeof first?.currencyCode === 'string' ? first.currencyCode : null) ??
    (typeof first?.currency_code === 'string' ? first.currency_code : null)
  return currency?.trim()?.toUpperCase() || null
}

export async function fetchGoogleCustomerNames(
  accessToken: string,
  customerIds: string[]
): Promise<Record<string, string>> {
  const namesById: Record<string, string> = {}
  for (const customerId of customerIds) {
    try {
      const rows = await executeGaql(
        accessToken,
        customerId,
        'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1'
      )
      const customer = (rows[0] as {
        customer?: { id?: unknown; descriptiveName?: unknown; descriptive_name?: unknown }
      } | undefined)?.customer
      const resolvedId =
        typeof customer?.id === 'string'
          ? customer.id
          : typeof customer?.id === 'number'
            ? String(customer.id)
            : customerId
      const rawName =
        (typeof customer?.descriptiveName === 'string' && customer.descriptiveName) ||
        (typeof customer?.descriptive_name === 'string' && customer.descriptive_name) ||
        ''
      const name = rawName.trim()
      if (name) namesById[resolvedId] = name
    } catch {
      // Best effort: keep rendering IDs if name lookup fails.
    }
  }
  return namesById
}

export { GOOGLE_DEVELOPER_TOKEN, GOOGLE_LOGIN_CUSTOMER_ID }
