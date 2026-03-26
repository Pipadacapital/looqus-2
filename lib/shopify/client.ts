import crypto from 'crypto'

const SHOPIFY_API_VERSION = '2025-01'
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID!
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET!

const DEFAULT_SCOPES =
  'read_orders,read_all_orders,read_products,read_customers,read_analytics,read_inventory,read_reports'

/**
 * Validates that a shop domain matches *.myshopify.com format.
 */
export function validateShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)
}

/**
 * Normalizes a user-provided store handle into a full myshopify.com domain.
 * Accepts "my-store", "my-store.myshopify.com", or "https://my-store.myshopify.com".
 */
export function normalizeShopDomain(input: string): string {
  let shop = input.trim().toLowerCase()
  shop = shop.replace(/^https?:\/\//, '')
  shop = shop.split('/')[0]
  if (!shop.endsWith('.myshopify.com')) {
    shop = `${shop}.myshopify.com`
  }
  return shop
}

/**
 * Generates a cryptographically random nonce for the OAuth state parameter.
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Builds the Shopify OAuth authorization URL using per-store credentials.
 */
export function buildAuthUrl(shop: string, state: string): string {
  const redirectUri = `${process.env.SHOPIFY_APP_URL}/api/shopify/callback`

  const params = new URLSearchParams({
    client_id: SHOPIFY_CLIENT_ID,
    scope: DEFAULT_SCOPES,
    redirect_uri: redirectUri,
    state,
  })

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`
}

/**
 * Validates the HMAC signature that Shopify sends on the OAuth callback.
 * Uses the per-store client secret for validation.
 */
export function validateHmac(query: Record<string, string>): boolean {
  const hmac = query.hmac
  if (!hmac) return false

  const entries = Object.entries(query)
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))

  const message = entries.map(([key, value]) => `${key}=${value}`).join('&')

  const generatedHmac = crypto
    .createHmac('sha256', SHOPIFY_CLIENT_SECRET)
    .update(message)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(generatedHmac, 'hex'),
    Buffer.from(hmac, 'hex')
  )
}

/**
 * Exchanges the temporary authorization code for a permanent offline access token.
 * Uses per-store client credentials (Client ID + Secret from Dev Dashboard).
 */
export async function exchangeCodeForToken(
  shop: string,
  code: string
): Promise<{ accessToken: string; scope: string }> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Shopify token exchange failed (${response.status}): ${text}`
    )
  }

  const data = await response.json()

  return {
    accessToken: data.access_token,
    scope: data.scope,
  }
}

/**
 * Fetches basic shop info using an access token.
 */
export async function fetchShopInfo(
  shopDomain: string,
  accessToken: string
): Promise<{ id: string; name: string }> {
  const response = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
    {
      headers: { 'X-Shopify-Access-Token': accessToken },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch shop info: ${response.status}`)
  }

  const data = await response.json()
  return {
    id: String(data.shop.id),
    name: data.shop.name,
  }
}
