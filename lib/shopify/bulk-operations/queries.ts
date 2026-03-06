/**
 * Shopify Bulk Operations – GraphQL Queries & Mutations
 *
 * All GraphQL strings needed to run, poll, and cancel bulk operations.
 * The inner query strings are dynamically built with date filters for the
 * 4-year backfill use case.
 */

// ─── Mutation: start a bulk query ──────────────────────────────────────────────
export const BULK_OPERATION_RUN_QUERY = `
  mutation BulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`

// ─── Query: poll the current bulk operation status ─────────────────────────────
export const CURRENT_BULK_OPERATION_STATUS = `
  query CurrentBulkOperationStatus {
    currentBulkOperation {
      id
      status
      errorCode
      createdAt
      completedAt
      objectCount
      fileSize
      url
      partialDataUrl
    }
  }
`

// ─── Mutation: cancel a running bulk operation ─────────────────────────────────
export const BULK_OPERATION_CANCEL = `
  mutation BulkOperationCancel($id: ID!) {
    bulkOperationCancel(id: $id) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`

// ─── Inner query builders (baked into the mutation's $query variable) ──────────
// Shopify bulk operations don't support GraphQL variables inside the inner query,
// so we hard-code the date filter directly into the query string.

/**
 * Builds the inner GraphQL query for bulk-exporting orders.
 * Includes line items with variant/product references.
 *
 * @param sinceDate – ISO date string like '2022-03-06'
 */
export function buildOrdersBulkQuery(sinceDate: string): string {
  return `{
    orders(query: "created_at:>='${sinceDate}'") {
      edges {
        node {
          id
          name
          email
          createdAt
          updatedAt
          processedAt
          cancelledAt
          displayFinancialStatus
          displayFulfillmentStatus
          currencyCode
          tags
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          subtotalPriceSet {
            shopMoney { amount currencyCode }
          }
          totalTaxSet {
            shopMoney { amount currencyCode }
          }
          totalDiscountsSet {
            shopMoney { amount currencyCode }
          }
          customer {
            id
          }
          lineItems {
            edges {
              node {
                id
                title
                quantity
                sku
                originalUnitPriceSet {
                  shopMoney { amount currencyCode }
                }
                variant {
                  title
                  product { id }
                }
              }
            }
          }
        }
      }
    }
  }`
}

/**
 * Builds the inner GraphQL query for bulk-exporting products with variants.
 */
export function buildProductsBulkQuery(): string {
  return `{
    products {
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          status
          tags
          featuredImage { url }
          totalInventory
          publishedAt
          variants {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }`
}

/**
 * Builds the inner GraphQL query for bulk-exporting customers.
 * @param sinceDate – ISO date string like '2022-03-06'
 */
export function buildCustomersBulkQuery(sinceDate: string): string {
  return `{
    customers(query: "created_at:>='${sinceDate}'") {
      edges {
        node {
          id
          email
          firstName
          lastName
          numberOfOrders
          amountSpent { amount currencyCode }
          tags
          state
          createdAt
        }
      }
    }
  }`
}
