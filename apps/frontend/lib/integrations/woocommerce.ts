function normalizeStoreUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  // Strip any path suffix (e.g. /wp-admin) — keep just origin
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return url
  }
}

function authHeader(consumerKey: string, consumerSecret: string): string {
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')
  return `Basic ${credentials}`
}

export async function fetchWoocommerceCurrency(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<string> {
  const url = `${normalizeStoreUrl(storeUrl)}/wp-json/wc/v3/settings/general`
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader(consumerKey, consumerSecret),
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) return 'USD'
    const settings: unknown = await res.json()
    if (!Array.isArray(settings)) return 'USD'
    const currencySetting = settings.find(
      (s: unknown) => typeof s === 'object' && s != null && (s as { id?: string }).id === 'woocommerce_currency'
    ) as { value?: string } | undefined
    return typeof currencySetting?.value === 'string' && currencySetting.value.trim().length > 0
      ? currencySetting.value.trim()
      : 'USD'
  } catch {
    return 'USD'
  }
}

export async function testWoocommerceConnection(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<{ success: boolean; storeName?: string; error?: string }> {
  const base = normalizeStoreUrl(storeUrl)
  try {
    const res = await fetch(`${base}/wp-json/wc/v3/`, {
      headers: {
        Authorization: authHeader(consumerKey, consumerSecret),
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      return { success: false, error: `WooCommerce API returned ${res.status}` }
    }
    const data = await res.json().catch(() => ({}))
    return { success: true, storeName: data.name ?? undefined }
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Connection failed' }
  }
}

export async function fetchWoocommerceOrders(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  after?: Date,
  page = 1
): Promise<{ orders: any[]; totalPages: number; total: number }> {
  const base = normalizeStoreUrl(storeUrl)
  const params = new URLSearchParams({
    per_page: '100',
    page: String(page),
    orderby: 'date',
    order: 'asc',
  })
  if (after) {
    params.set('after', after.toISOString())
  }

  const res = await fetch(`${base}/wp-json/wc/v3/orders?${params}`, {
    headers: {
      Authorization: authHeader(consumerKey, consumerSecret),
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error(`WooCommerce orders fetch failed: ${res.status}`)
  }

  const orders = await res.json()
  const totalPages = parseInt(res.headers.get('X-WP-TotalPages') ?? '1', 10)
  const total = parseInt(res.headers.get('X-WP-Total') ?? '0', 10)

  return { orders, totalPages, total }
}

export async function fetchWoocommerceProducts(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  page = 1
): Promise<{ products: any[]; totalPages: number }> {
  const base = normalizeStoreUrl(storeUrl)
  const params = new URLSearchParams({
    per_page: '100',
    page: String(page),
  })

  const res = await fetch(`${base}/wp-json/wc/v3/products?${params}`, {
    headers: {
      Authorization: authHeader(consumerKey, consumerSecret),
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error(`WooCommerce products fetch failed: ${res.status}`)
  }

  const products = await res.json()
  const totalPages = parseInt(res.headers.get('X-WP-TotalPages') ?? '1', 10)

  return { products, totalPages }
}

export async function fetchWoocommerceOrderRefunds(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  orderId: number
): Promise<any[]> {
  const base = normalizeStoreUrl(storeUrl)
  const allRefunds: any[] = []
  let page = 1
  let totalPages = 1

  do {
    const params = new URLSearchParams({
      per_page: '100',
      page: String(page),
    })
    const res = await fetch(`${base}/wp-json/wc/v3/orders/${orderId}/refunds?${params}`, {
      headers: {
        Authorization: authHeader(consumerKey, consumerSecret),
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      throw new Error(`WooCommerce refunds fetch failed: ${res.status}`)
    }

    const refunds = await res.json()
    allRefunds.push(...refunds)
    totalPages = parseInt(res.headers.get('X-WP-TotalPages') ?? '1', 10)
    page += 1
  } while (page <= totalPages)

  return allRefunds
}

export async function fetchWoocommerceProductVariations(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  productId: number
): Promise<any[]> {
  const base = normalizeStoreUrl(storeUrl)
  const allVariations: any[] = []
  let page = 1
  let totalPages = 1

  do {
    const params = new URLSearchParams({
      per_page: '100',
      page: String(page),
    })

    const res = await fetch(
      `${base}/wp-json/wc/v3/products/${productId}/variations?${params}`,
      {
        headers: {
          Authorization: authHeader(consumerKey, consumerSecret),
          'Content-Type': 'application/json',
        },
      }
    )

    if (!res.ok) {
      throw new Error(`WooCommerce product variations fetch failed: ${res.status}`)
    }

    const variations = await res.json()
    allVariations.push(...variations)
    totalPages = parseInt(res.headers.get('X-WP-TotalPages') ?? '1', 10)
    page += 1
  } while (page <= totalPages)

  return allVariations
}
