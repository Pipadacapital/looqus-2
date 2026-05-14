/**
 * Shopify Bulk Operations – Shared Types
 *
 * Types for the bulk operation lifecycle:
 *   submit mutation → poll status → download JSONL → parse & upsert
 */

// ─── Bulk Operation Status from Shopify ────────────────────────────────────────
export type BulkOperationStatus =
  | 'CREATED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CANCELING'
  | 'CANCELED'
  | 'FAILED'
  | 'EXPIRED'

export interface BulkOperationNode {
  id: string
  status: BulkOperationStatus
  errorCode: string | null
  createdAt: string
  completedAt: string | null
  objectCount: string // Shopify returns this as a string
  fileSize: string | null
  url: string | null
  partialDataUrl: string | null
}

// ─── Mutation response shapes ──────────────────────────────────────────────────
export interface BulkOperationRunQueryResponse {
  bulkOperationRunQuery: {
    bulkOperation: { id: string; status: BulkOperationStatus } | null
    userErrors: Array<{ field: string[]; message: string }>
  }
}

export interface CurrentBulkOperationResponse {
  currentBulkOperation: BulkOperationNode | null
}

// ─── Resource types we support for bulk export ─────────────────────────────────
export type BulkResourceType = 'orders' | 'products' | 'customers'

// ─── JSONL row shapes (flat nodes from Shopify JSONL) ──────────────────────────

/** Top-level order node */
export interface BulkOrderRow {
  id: string          // gid://shopify/Order/...
  name: string
  email: string | null
  createdAt: string
  updatedAt: string
  processedAt: string | null
  cancelledAt: string | null
  displayFinancialStatus: string
  displayFulfillmentStatus: string | null
  currencyCode: string
  tags: string[]
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
  subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
  totalTaxSet: { shopMoney: { amount: string; currencyCode: string } }
  totalDiscountsSet: { shopMoney: { amount: string; currencyCode: string } }
  customer: { id: string } | null
  __parentId?: undefined  // top-level nodes don't have this
}

/** Nested line item node (flattened by Shopify bulk) */
export interface BulkLineItemRow {
  id: string          // gid://shopify/LineItem/...
  title: string
  quantity: number
  sku: string | null
  originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } }
  variant: { title: string; product: { id: string } | null } | null
  __parentId: string  // gid://shopify/Order/...
}

/** Top-level product node */
export interface BulkProductRow {
  id: string
  title: string
  handle: string
  vendor: string | null
  productType: string | null
  status: string
  tags: string[]
  featuredImage: { url: string } | null
  totalInventory: number | null
  publishedAt: string | null
  __parentId?: undefined
}

/** Nested variant node */
export interface BulkVariantRow {
  id: string
  title: string | null
  sku: string | null
  price: string | null
  compareAtPrice: string | null
  inventoryQuantity: number | null
  __parentId: string  // gid://shopify/Product/...
}

/** Top-level customer node */
export interface BulkCustomerRow {
  id: string
  email: string | null
  firstName: string | null
  lastName: string | null
  numberOfOrders: string
  amountSpent: { amount: string; currencyCode: string }
  tags: string[]
  state: string | null
  createdAt: string
  __parentId?: undefined
}

// ─── Backfill job result ───────────────────────────────────────────────────────
export interface BulkBackfillResult {
  resource: BulkResourceType
  status: 'completed' | 'failed' | 'skipped'
  processedCount: number
  error?: string
  durationMs: number
}

export interface FullBackfillResult {
  connectionId: string
  startedAt: string
  completedAt: string
  results: BulkBackfillResult[]
}

// ─── Polling options ───────────────────────────────────────────────────────────
export interface PollOptions {
  /** Polling interval in ms (default 5000) */
  intervalMs?: number
  /** Max time to wait before timing out in ms (default 30 minutes) */
  timeoutMs?: number
  /** Callback for progress updates */
  onProgress?: (op: BulkOperationNode) => void
}
