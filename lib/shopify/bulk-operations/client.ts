/**
 * Shopify Bulk Operations – Core Client
 *
 * Handles the complete lifecycle:
 *   1. Submit a bulk query mutation
 *   2. Poll until COMPLETED / FAILED
 *   3. Download the JSONL result file
 *   4. Stream-parse it line by line
 *
 * This module is resource-agnostic – it doesn't know what entity you're
 * exporting. The caller passes the inner GraphQL query and a line processor.
 */

import { shopifyGraphQL } from '../graphql'
import {
  BULK_OPERATION_RUN_QUERY,
  CURRENT_BULK_OPERATION_STATUS,
  BULK_OPERATION_CANCEL,
} from './queries'
import type {
  BulkOperationRunQueryResponse,
  CurrentBulkOperationResponse,
  BulkOperationNode,
  PollOptions,
} from './types'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── 1. Submit ─────────────────────────────────────────────────────────────────

/**
 * Starts a Shopify bulk operation query.
 * Only one bulk operation can run at a time per store.
 * Returns the operation ID on success.
 */
export async function submitBulkQuery(params: {
  shopDomain: string
  accessToken: string
  query: string // the inner GraphQL query (e.g. from buildOrdersBulkQuery)
}): Promise<{ operationId: string }> {
  const { shopDomain, accessToken, query } = params

  const data = await shopifyGraphQL<BulkOperationRunQueryResponse>({
    shopDomain,
    accessToken,
    query: BULK_OPERATION_RUN_QUERY,
    variables: { query },
  })

  const result = data.bulkOperationRunQuery
  if (result.userErrors?.length) {
    const msgs = result.userErrors.map((e) => e.message).join('; ')
    throw new Error(`Bulk operation submit failed: ${msgs}`)
  }

  if (!result.bulkOperation?.id) {
    throw new Error('Bulk operation submit returned no operation ID')
  }

  console.log(
    `[BulkOps] Submitted bulk operation: ${result.bulkOperation.id} (status: ${result.bulkOperation.status})`
  )

  return { operationId: result.bulkOperation.id }
}

// ─── 2. Poll ───────────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 5_000    // 5 seconds
const DEFAULT_POLL_TIMEOUT_MS = 60 * 60 * 1000 // 60 minutes (bulk can be slow for 4 years of data)

/**
 * Polls `currentBulkOperation` until status is terminal (COMPLETED / FAILED / CANCELED / EXPIRED).
 * Returns the final operation node.
 */
export async function pollBulkOperation(params: {
  shopDomain: string
  accessToken: string
  operationId: string
  options?: PollOptions
}): Promise<BulkOperationNode> {
  const { shopDomain, accessToken, operationId, options } = params
  const interval = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeout = options?.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
  const startTime = Date.now()

  let lastObjectCount = '0'

  while (true) {
    const elapsed = Date.now() - startTime
    if (elapsed > timeout) {
      throw new Error(
        `Bulk operation ${operationId} timed out after ${Math.round(timeout / 1000)}s`
      )
    }

    const data = await shopifyGraphQL<CurrentBulkOperationResponse>({
      shopDomain,
      accessToken,
      query: CURRENT_BULK_OPERATION_STATUS,
    })

    const op = data.currentBulkOperation
    if (!op) {
      throw new Error('No current bulk operation found (it may have completed already)')
    }

    // Log progress
    if (op.objectCount !== lastObjectCount) {
      console.log(
        `[BulkOps] ${operationId} — status: ${op.status}, objects: ${op.objectCount}, elapsed: ${Math.round(elapsed / 1000)}s`
      )
      lastObjectCount = op.objectCount
    }

    // Notify caller of progress
    options?.onProgress?.(op)

    // Terminal states
    if (['COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED'].includes(op.status)) {
      console.log(
        `[BulkOps] ${operationId} finished — status: ${op.status}, objects: ${op.objectCount}, fileSize: ${op.fileSize ?? 'n/a'}`
      )
      return op
    }

    await sleep(interval)
  }
}

// ─── 3. Download & parse JSONL ─────────────────────────────────────────────────

/**
 * Downloads the bulk operation JSONL file and parses it line-by-line.
 * Returns all parsed JSON objects as an array.
 *
 * For very large files in production you'd want to stream-process this,
 * but for a backfill script that runs as a background job this is practical.
 */
export async function downloadAndParseJsonl(url: string): Promise<Record<string, unknown>[]> {
  console.log(`[BulkOps] Downloading JSONL from: ${url.substring(0, 80)}...`)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download JSONL: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  const lines = text.split('\n').filter((line) => line.trim().length > 0)

  console.log(`[BulkOps] Downloaded ${lines.length} JSONL lines (${(text.length / 1024 / 1024).toFixed(2)} MB)`)

  const results: Record<string, unknown>[] = []
  for (const line of lines) {
    try {
      results.push(JSON.parse(line))
    } catch (err) {
      console.warn(`[BulkOps] Skipping unparseable JSONL line: ${line.substring(0, 100)}`)
    }
  }

  return results
}

// ─── 4. Cancel ─────────────────────────────────────────────────────────────────

/**
 * Cancels a running bulk operation.
 */
export async function cancelBulkOperation(params: {
  shopDomain: string
  accessToken: string
  operationId: string
}): Promise<void> {
  const { shopDomain, accessToken, operationId } = params

  await shopifyGraphQL({
    shopDomain,
    accessToken,
    query: BULK_OPERATION_CANCEL,
    variables: { id: operationId },
  })

  console.log(`[BulkOps] Cancelled operation: ${operationId}`)
}

// ─── 5. Full pipeline helper ───────────────────────────────────────────────────

/**
 * Runs the full bulk operation pipeline:
 *   submit → poll → download → parse JSONL
 *
 * Returns the parsed JSONL rows.
 */
export async function runBulkQuery(params: {
  shopDomain: string
  accessToken: string
  query: string       // inner GraphQL query
  pollOptions?: PollOptions
}): Promise<Record<string, unknown>[]> {
  const { shopDomain, accessToken, query, pollOptions } = params

  // 1. Submit
  const { operationId } = await submitBulkQuery({ shopDomain, accessToken, query })

  // 2. Poll
  const finalOp = await pollBulkOperation({
    shopDomain,
    accessToken,
    operationId,
    options: pollOptions,
  })

  // 3. Check result
  if (finalOp.status === 'FAILED') {
    throw new Error(`Bulk operation failed: ${finalOp.errorCode ?? 'unknown error'}`)
  }

  if (finalOp.status !== 'COMPLETED') {
    throw new Error(`Bulk operation ended with unexpected status: ${finalOp.status}`)
  }

  if (!finalOp.url) {
    console.log('[BulkOps] Operation completed with no results (empty dataset)')
    return []
  }

  // 4. Download & parse
  return downloadAndParseJsonl(finalOp.url)
}
