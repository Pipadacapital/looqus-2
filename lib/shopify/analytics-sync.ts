import { prisma } from '@/lib/prisma'
import { shopifyGraphQL } from './graphql'

/** Response shape from shopifyqlQuery (tableData.columns + tableData.rows as object[]) */
type ShopifyQlTableData = {
  columns: { name: string; dataType?: string; displayName?: string }[]
  rows: Record<string, string | number | null>[]
}

const SHOPIFY_ANALYTICS_QUERY = `
  query RunSalesAnalytics($shopifyql: String!) {
    shopifyqlQuery(query: $shopifyql) {
      tableData {
        columns {
          name
          dataType
          displayName
        }
        rows
      }
      parseErrors
    }
  }
`

/**
 * Builds ShopifyQL for daily sales metrics using the sales dataset.
 * Uses SINCE/UNTIL with yyyy-MM-dd. TIMESERIES day returns one row per day.
 */
/**
 * Builds ShopifyQL for daily sessions and conversion rate using the sessions dataset.
 */
function buildSessionsQl(from: string, to: string): string {
  return `FROM sessions
  SHOW sessions, conversion_rate
  TIMESERIES day
  SINCE ${from} UNTIL ${to}
  ORDER BY day`
}

function buildShopifyAnalyticsQl(from: string, to: string): string {
  return `FROM sales
  SHOW gross_sales, net_sales, discounts, taxes, orders, total_returns, returns
  TIMESERIES day
  SINCE ${from} UNTIL ${to}
  ORDER BY day`
}

/**
 * Fetches daily sessions and conversion_rate from ShopifyQL sessions dataset
 * and updates existing shopify_analytics_daily rows (does not create new rows).
 * Run after syncShopifyAnalyticsFromOrders so daily rows exist.
 */
export async function syncShopifySessionsFromShopifyQL(
  connectionId: string,
  from: string,
  to: string
): Promise<{ daysUpdated: number }> {
  const conn = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: { shopDomain: true, accessToken: true },
  })

  if (!conn?.accessToken) {
    throw new Error('Connection not found or missing access token')
  }

  const shopifyql = buildSessionsQl(from, to)

  const data: {
    shopifyqlQuery: {
      tableData: ShopifyQlTableData | null
      parseErrors: string[]
    }
  } = await shopifyGraphQL({
    shopDomain: conn.shopDomain,
    accessToken: conn.accessToken,
    query: SHOPIFY_ANALYTICS_QUERY,
    variables: { shopifyql },
    apiVersion: '2025-10',
  })

  if (data.shopifyqlQuery.parseErrors?.length) {
    throw new Error(
      `ShopifyQL parse errors: ${data.shopifyqlQuery.parseErrors.join('; ')}`
    )
  }

  const table = data.shopifyqlQuery.tableData
  if (!table?.rows?.length) {
    return { daysUpdated: 0 }
  }

  let daysUpdated = 0
  for (const row of table.rows) {
    const dayStr = String(row['day'] ?? '')
    const sessions = Number(row['sessions'] ?? 0)
    const conversionRate =
      row['conversion_rate'] != null ? Number(row['conversion_rate']) : null

    const date = new Date(`${dayStr}T00:00:00.000Z`)

    const result = await prisma.shopifyAnalyticsDaily.updateMany({
      where: { connectionId, date },
      data: {
        sessions: sessions || null,
        conversionRate: conversionRate != null ? conversionRate : null,
      },
    })
    if (result.count > 0) daysUpdated++
  }

  return { daysUpdated }
}

/**
 * Fetches daily Shopify analytics (gross_sales, net_sales, discounts, taxes, orders,
 * total_returns, returns) from ShopifyQL sales dataset and upserts into shopify_analytics_daily.
 * P&L uses: refunds = total_returns, productRefunds = returns, shippingRefunds = total_returns - returns.
 *
 * Uses the validated shopifyqlQuery API: tableData.columns + tableData.rows (objects keyed by column name).
 */
export async function syncShopifyAnalyticsFromOrders(
  connectionId: string,
  from: string,
  to: string
): Promise<{ daysUpserted: number }> {
  const conn = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: { shopDomain: true, accessToken: true },
  })

  if (!conn?.accessToken) {
    throw new Error('Connection not found or missing access token')
  }

  const shopifyql = buildShopifyAnalyticsQl(from, to)

  const data: {
    shopifyqlQuery: {
      tableData: ShopifyQlTableData | null
      parseErrors: string[]
    }
  } = await shopifyGraphQL({
    shopDomain: conn.shopDomain,
    accessToken: conn.accessToken,
    query: SHOPIFY_ANALYTICS_QUERY,
    variables: { shopifyql },
    apiVersion: '2025-10', // shopifyqlQuery exists from 2025-10
  })

  if (data.shopifyqlQuery.parseErrors?.length) {
    throw new Error(
      `ShopifyQL parse errors: ${data.shopifyqlQuery.parseErrors.join('; ')}`
    )
  }

  const table = data.shopifyqlQuery.tableData
  const rowsReturned = table?.rows?.length ?? 0
  console.log('[syncShopifyAnalytics] range:', from, '→', to)
  console.log('[syncShopifyAnalytics] rows returned from Shopify:', rowsReturned)
  if (!table?.rows?.length) {
    return { daysUpserted: 0 }
  }

  // Raw ShopifyQL response log for debugging (query, parseErrors, columns, first 20 rows)
  console.log('[syncShopifyAnalytics] RAW shopifyqlQuery:')
  console.log('[syncShopifyAnalytics] query string:', shopifyql)
  console.log('[syncShopifyAnalytics] parseErrors:', data.shopifyqlQuery.parseErrors)
  console.log('[syncShopifyAnalytics] tableData.columns:', JSON.stringify(table.columns))
  console.log('[syncShopifyAnalytics] tableData.rows (first 20):', JSON.stringify(table.rows.slice(0, 20)))

  const totalReturnsRaw = (row: Record<string, string | number | null>) =>
    row['total_returns'] != null ? Number(row['total_returns']) : 0
  const returnsRaw = (row: Record<string, string | number | null>) =>
    row['returns'] != null ? Number(row['returns']) : 0

  // Normalize day to UTC date-only (YYYY-MM-DD) so we never write wrong date due to timezone or format
  function toDateOnly(row: Record<string, string | number | null>): string {
    const dayRaw = row['day']
    if (dayRaw == null) return ''
    if (typeof dayRaw === 'string') {
      const match = dayRaw.match(/^(\d{4}-\d{2}-\d{2})/)
      return match ? match[1] : dayRaw.slice(0, 10)
    }
    return new Date(dayRaw).toISOString().slice(0, 10)
  }

  // Clear stale total_returns and returns for this range before writing fresh ShopifyQL values
  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T23:59:59.999Z`)
  await prisma.shopifyAnalyticsDaily.updateMany({
    where: {
      connectionId,
      date: { gte: fromDate, lte: toDate },
    },
    data: { total_returns: 0, returns: 0 },
  })

  let daysUpserted = 0
  for (const row of table.rows) {
    const dateOnly = toDateOnly(row)
    if (!dateOnly || dateOnly.length < 10) continue

    const grossSales = Number(row['gross_sales'] ?? 0)
    const netSales = Number(row['net_sales'] ?? 0)
    const discounts = Number(row['discounts'] ?? 0)
    const taxes = Number(row['taxes'] ?? 0)
    const ordersCount = Number(row['orders'] ?? 0)
    const totalReturns = totalReturnsRaw(row)
    const returnsVal = returnsRaw(row)

    const date = new Date(`${dateOnly}T00:00:00.000Z`)

    await prisma.shopifyAnalyticsDaily.upsert({
      where: {
        connectionId_date: {
          connectionId,
          date,
        },
      },
      create: {
        connectionId,
        date,
        netSales,
        grossSales,
        ordersCount,
        aov: ordersCount > 0 ? netSales / ordersCount : 0,
        totalTax: taxes,
        totalDiscount: discounts,
        total_returns: totalReturns,
        returns: returnsVal,
        currency: 'INR',
      },
      update: {
        netSales,
        grossSales,
        ordersCount,
        aov: ordersCount > 0 ? netSales / ordersCount : 0,
        totalTax: taxes,
        totalDiscount: discounts,
        total_returns: totalReturns,
        returns: returnsVal,
      },
    })

    daysUpserted++
  }

  // First 3 parsed days (temporary log)
  const first3 = table.rows.slice(0, 3).map((row) => ({
    day: toDateOnly(row),
    gross_sales: row['gross_sales'],
    net_sales: row['net_sales'],
    orders: row['orders'],
    total_tax: row['taxes'],
    total_discount: row['discounts'],
    total_returns: row['total_returns'],
    returns: row['returns'],
  }))
  console.log('[syncShopifyAnalytics] first 3 parsed days:', JSON.stringify(first3))
  console.log('[syncShopifyAnalytics] rows upserted:', daysUpserted)

  return { daysUpserted }
}

