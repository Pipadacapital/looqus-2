import crypto from 'crypto'

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || 'read_orders,read_products,read_customers,read_analytics,read_inventory'

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

  // Strip protocol
  shop = shop.replace(/^https?:\/\//, '')
  // Strip trailing slash or path
  shop = shop.split('/')[0]
  // Append .myshopify.com if not present
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
 * Builds the Shopify OAuth authorization URL.
 */
export function buildAuthUrl(shop: string, state: string): string {
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/shopify/callback`

  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
  })

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`
}

/**
 * Validates the HMAC signature that Shopify sends on the OAuth callback.
 * Shopify signs the query parameters (excluding `hmac` and `signature`)
 * using the app's API secret.
 */
export function validateHmac(query: Record<string, string>): boolean {
  const hmac = query.hmac
  if (!hmac) return false

  // Build the message from sorted query params, excluding hmac and signature
  const entries = Object.entries(query)
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))

  const message = entries
    .map(([key, value]) => `${key}=${value}`)
    .join('&')

  const generatedHmac = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(generatedHmac, 'hex'),
    Buffer.from(hmac, 'hex')
  )
}

/**
 * Exchanges the temporary authorization code for a permanent access token.
 * Returns the access token, granted scopes, and optional store info.
 */
export async function exchangeCodeForToken(
  shop: string,
  code: string
): Promise<{
  accessToken: string
  scope: string
}> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Shopify token exchange failed (${response.status}): ${text}`)
  }

  const data = await response.json()

  return {
    accessToken: data.access_token,
    scope: data.scope,
  }
}

/**
 * Fetches basic shop info using the access token.
 * Used to retrieve the Shopify store ID after connecting.
 */
export async function fetchShopInfo(
  shop: string,
  accessToken: string
): Promise<{ id: string; name: string }> {
  const response = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch shop info: ${response.status}`)
  }

  const data = await response.json()
  return {
    id: String(data.shop.id),
    name: data.shop.name,
  }
}
