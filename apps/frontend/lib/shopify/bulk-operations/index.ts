/**
 * Shopify Bulk Operations Module
 *
 * Public API for the bulk operations module.
 * Import everything you need from this barrel file:
 *
 *   import { runFullBackfill } from '@/lib/shopify/bulk-operations'
 */

// Orchestrator (main entry point)
export { runFullBackfill } from './backfill'

// Core client (if you need fine-grained control)
export {
  submitBulkQuery,
  pollBulkOperation,
  downloadAndParseJsonl,
  cancelBulkOperation,
  runBulkQuery,
} from './client'

// Query builders (for constructing custom bulk queries)
export {
  buildOrdersBulkQuery,
  buildProductsBulkQuery,
  buildCustomersBulkQuery,
} from './queries'

// DB processors (for processing JSONL rows into DB)
export {
  processOrderRows,
  processProductRows,
  processCustomerRows,
} from './processors'

// Types
export type {
  BulkOperationStatus,
  BulkOperationNode,
  BulkOperationRunQueryResponse,
  CurrentBulkOperationResponse,
  BulkResourceType,
  BulkBackfillResult,
  FullBackfillResult,
  PollOptions,
} from './types'
