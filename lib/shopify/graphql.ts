const SHOPIFY_API_VERSION = '2025-01'

export type ShopifyGraphQLResponse<T> = {
  data?: T
  errors?: Array<{ message: string; locations?: unknown }>
  extensions?: {
    cost?: {
      requestedQueryCost: number
      throttleStatus: { currentlyAvailable: number }
    }
  }
}

/**
 * Executes a GraphQL query against the Shopify Admin GraphQL API.
 * Handles errors and optional rate-limit backoff.
 * @param apiVersion - Optional API version (e.g. '2025-10'). Defaults to SHOPIFY_API_VERSION. Use 2025-10+ for shopifyqlQuery.
 */
export async function shopifyGraphQL<T>(params: {
  shopDomain: string
  accessToken: string
  query: string
  variables?: Record<string, unknown>
  apiVersion?: string
}): Promise<T> {
  const { shopDomain, accessToken, query, variables, apiVersion } = params
  const version = apiVersion ?? SHOPIFY_API_VERSION
  const url = `https://${shopDomain}/admin/api/${version}/graphql.json`

  const body: string = JSON.stringify({ query, variables })
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * attempt))
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body,
    })

    const json = (await res.json()) as ShopifyGraphQLResponse<T>

    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join('; ')
      throw new Error(`Shopify GraphQL: ${msg}`)
    }

    if (!res.ok) {
      if (res.status === 429 && attempt < 2) continue
      lastError = new Error(`Shopify API ${res.status}: ${res.statusText}`)
      if (attempt < 2) continue
      throw lastError
    }

    if (json.extensions?.cost?.throttleStatus?.currentlyAvailable && json.extensions.cost.throttleStatus.currentlyAvailable < 10 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000))
      continue
    }

    if (json.data == null) {
      throw new Error('Shopify GraphQL: no data in response')
    }

    return json.data
  }

  throw lastError ?? new Error('Shopify GraphQL: request failed')
}
