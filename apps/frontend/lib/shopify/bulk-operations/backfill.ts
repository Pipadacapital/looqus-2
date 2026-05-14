/**
 * Shopify Bulk Operations – Backfill Orchestrator
 *
 * Coordinates the full 4-year backfill for a Shopify connection:
 *   - Orders (with line items)
 *   - Products (with variants)
 *   - Customers
 *
 * Each resource type runs sequentially (Shopify only allows ONE bulk
 * operation at a time per store), but within each resource the DB
 * processing runs in parallel batches.
 *
 * This module is designed to be run as a background job triggered by
 * an API route. It does NOT touch the existing paginated sync code.
 */

import { prisma } from '@/lib/prisma'
import { runBulkQuery } from './client'
import {
  buildOrdersBulkQuery,
  buildProductsBulkQuery,
  buildCustomersBulkQuery,
} from './queries'
import {
  processOrderRows,
  processProductRows,
  processCustomerRows,
} from './processors'
import type {
  BulkResourceType,
  BulkBackfillResult,
  FullBackfillResult,
  PollOptions,
} from './types'

// ─── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_BACKFILL_YEARS = 4

/**
 * Computes the cutoff date for the backfill.
 * Default: 4 years ago from today.
 */
function getBackfillSinceDate(yearsBack?: number): string {
  const years = yearsBack ?? DEFAULT_BACKFILL_YEARS
  const date = new Date()
  date.setFullYear(date.getFullYear() - years)
  return date.toISOString().split('T')[0] // 'YYYY-MM-DD'
}

// ─── Single-resource backfill ──────────────────────────────────────────────────

async function backfillResource(params: {
  connectionId: string
  shopDomain: string
  accessToken: string
  resource: BulkResourceType
  sinceDate: string
  pollOptions?: PollOptions
}): Promise<BulkBackfillResult> {
  const { connectionId, shopDomain, accessToken, resource, sinceDate, pollOptions } = params
  const startTime = Date.now()

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`[BulkBackfill] Starting ${resource} backfill (since ${sinceDate})`)
  console.log(`${'═'.repeat(60)}\n`)

  try {
    // 1. Build the inner query
    let innerQuery: string
    switch (resource) {
      case 'orders':
        innerQuery = buildOrdersBulkQuery(sinceDate)
        break
      case 'products':
        innerQuery = buildProductsBulkQuery()
        break
      case 'customers':
        innerQuery = buildCustomersBulkQuery(sinceDate)
        break
      default:
        throw new Error(`Unknown resource type: ${resource}`)
    }

    // 2. Run the bulk operation (submit → poll → download → parse)
    const rows = await runBulkQuery({
      shopDomain,
      accessToken,
      query: innerQuery,
      pollOptions,
    })

    if (rows.length === 0) {
      console.log(`[BulkBackfill] No ${resource} data returned from bulk operation`)
      return {
        resource,
        status: 'completed',
        processedCount: 0,
        durationMs: Date.now() - startTime,
      }
    }

    // 3. Process rows into database
    let processedCount = 0
    switch (resource) {
      case 'orders': {
        const result = await processOrderRows(connectionId, rows)
        processedCount = result.ordersProcessed
        console.log(
          `[BulkBackfill] Orders: ${result.ordersProcessed} orders, ${result.lineItemsProcessed} line items`
        )
        break
      }
      case 'products': {
        const result = await processProductRows(connectionId, rows)
        processedCount = result.productsProcessed
        console.log(
          `[BulkBackfill] Products: ${result.productsProcessed} products, ${result.variantsProcessed} variants`
        )
        break
      }
      case 'customers': {
        const result = await processCustomerRows(connectionId, rows)
        processedCount = result.customersProcessed
        console.log(`[BulkBackfill] Customers: ${result.customersProcessed} customers`)
        break
      }
    }

    const durationMs = Date.now() - startTime
    console.log(
      `[BulkBackfill] ✅ ${resource} complete — ${processedCount} records in ${(durationMs / 1000).toFixed(1)}s`
    )

    return {
      resource,
      status: 'completed',
      processedCount,
      durationMs,
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[BulkBackfill] ❌ ${resource} failed after ${(durationMs / 1000).toFixed(1)}s: ${errorMsg}`)

    return {
      resource,
      status: 'failed',
      processedCount: 0,
      error: errorMsg,
      durationMs,
    }
  }
}

// ─── Full backfill ─────────────────────────────────────────────────────────────

/**
 * Runs a full 4-year backfill for all Shopify resources:
 *   1. Orders (with line items)
 *   2. Products (with variants)
 *   3. Customers
 *
 * Each runs sequentially because Shopify only allows one bulk operation
 * at a time per store.
 *
 * @param connectionId – The ShopifyConnection ID
 * @param options.yearsBack – How many years to go back (default: 4)
 * @param options.resources – Which resources to backfill (default: all)
 * @param options.pollOptions – Override polling interval / timeout
 */
export async function runFullBackfill(
  connectionId: string,
  options?: {
    yearsBack?: number
    resources?: BulkResourceType[]
    pollOptions?: PollOptions
  }
): Promise<FullBackfillResult> {
  const startedAt = new Date().toISOString()
  const sinceDate = getBackfillSinceDate(options?.yearsBack)
  const resources = options?.resources ?? ['orders', 'products', 'customers']

  // Fetch connection details
  const conn = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: { shopDomain: true, accessToken: true },
  })

  if (!conn?.accessToken) {
    throw new Error('Connection not found or missing access token')
  }

  console.log(`\n${'▓'.repeat(60)}`)
  console.log(`[BulkBackfill] Full backfill starting`)
  console.log(`  Connection: ${connectionId}`)
  console.log(`  Shop: ${conn.shopDomain}`)
  console.log(`  Since: ${sinceDate}`)
  console.log(`  Resources: ${resources.join(', ')}`)
  console.log(`${'▓'.repeat(60)}\n`)

  const results: BulkBackfillResult[] = []

  for (const resource of resources) {
    const result = await backfillResource({
      connectionId,
      shopDomain: conn.shopDomain,
      accessToken: conn.accessToken,
      resource,
      sinceDate,
      pollOptions: options?.pollOptions,
    })
    results.push(result)
  }

  // Update last sync timestamp
  await prisma.shopifyConnection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date() },
  })

  const completedAt = new Date().toISOString()

  // Summary
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0)
  const totalRecords = results.reduce((sum, r) => sum + r.processedCount, 0)
  const failedResources = results.filter((r) => r.status === 'failed')

  console.log(`\n${'▓'.repeat(60)}`)
  console.log(`[BulkBackfill] Full backfill complete`)
  console.log(`  Total records: ${totalRecords}`)
  console.log(`  Total time: ${(totalDuration / 1000).toFixed(1)}s`)
  if (failedResources.length > 0) {
    console.log(`  ⚠️ Failed: ${failedResources.map((r) => r.resource).join(', ')}`)
  } else {
    console.log(`  ✅ All resources synced successfully`)
  }
  console.log(`${'▓'.repeat(60)}\n`)

  return {
    connectionId,
    startedAt,
    completedAt,
    results,
  }
}
