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
function buildShopifyAnalyticsQl(from: string, to: string): string {
  return `FROM sales
  SHOW gross_sales, net_sales, discounts, taxes, orders
  TIMESERIES day
  SINCE ${from} UNTIL ${to}
  ORDER BY day`
}

/**
 * Fetches daily Shopify analytics (gross_sales, net_sales, discounts, taxes, orders)
 * from ShopifyQL sales dataset and upserts into shopify_analytics_daily.
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
  if (!table?.rows?.length) {
    return { daysUpserted: 0 }
  }

  let daysUpserted = 0
  for (const row of table.rows) {
    const dayStr = String(row['day'] ?? '')
    const grossSales = Number(row['gross_sales'] ?? 0)
    const netSales = Number(row['net_sales'] ?? 0)
    const discounts = Number(row['discounts'] ?? 0)
    const taxes = Number(row['taxes'] ?? 0)
    const ordersCount = Number(row['orders'] ?? 0)

    const date = new Date(`${dayStr}T00:00:00.000Z`)

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
        currency: 'INR',
      },
      update: {
        netSales,
        grossSales,
        ordersCount,
        aov: ordersCount > 0 ? netSales / ordersCount : 0,
        totalTax: taxes,
        totalDiscount: discounts,
      },
    })

    daysUpserted++
  }

  return { daysUpserted }
}
