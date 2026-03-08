/**
 * Inventory calculator for AI context.
 * Extracts inventory health from api/workspaces/[slug]/inventory/route.ts
 */
import type { PrismaClient } from '@prisma/client'
import type { AiInventoryData } from './types'

export async function calcInventory(
  prisma: PrismaClient,
  connectionId: string,
): Promise<AiInventoryData | null> {
  try {
    // Get all products with inventory
    const products = await prisma.shopifyProduct.findMany({
      where: { connectionId },
      select: {
        shopifyId: true,
        title: true,
        totalInventory: true,
        vendor: true,
        productType: true,
      },
    })

    const variants = await prisma.shopifyVariant.findMany({
      where: {
        product: { connectionId },
      },
      select: {
        shopifyId: true,
        inventoryQuantity: true,
       productId: true
      },
    })

    // Get 30-day sales velocity per product
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30)
    const lineItems = await prisma.shopifyLineItem.findMany({
      where: {
        connectionId,
        order: { processedAt: { gte: thirtyDaysAgo } },
      },
      select: { productShopifyId: true, quantity: true },
    })

    const salesMap = new Map<string, number>()
    for (const li of lineItems) {
      if (li.productShopifyId) {
        salesMap.set(li.productShopifyId, (salesMap.get(li.productShopifyId) ?? 0) + li.quantity)
      }
    }

    let totalProducts = products.length
    let totalVariantsCount = variants.length
    let totalUnits = 0
    let deadStockCount = 0
    let lowStockCount = 0
    let healthyStockCount = 0
    let overStockCount = 0
    let sellThroughSum = 0
    let daysLeftSum = 0
    let daysLeftCount = 0

    for (const p of products) {
      const inventory = p.totalInventory ?? 0
      totalUnits += inventory
      const sold30d = salesMap.get(p.shopifyId) ?? 0
      const dailyVelocity = sold30d / 30

      // Sell-through rate (30d)
      const beginning = inventory + sold30d
      const sellThrough = beginning > 0 ? (sold30d / beginning) * 100 : 0
      sellThroughSum += sellThrough

      // Days left
      const daysLeft = dailyVelocity > 0 ? inventory / dailyVelocity : Infinity

      if (daysLeft !== Infinity) {
        daysLeftSum += daysLeft
        daysLeftCount++
      }

      // Classify
      if (inventory <= 0 || (sold30d === 0 && inventory > 0)) {
        deadStockCount++
      } else if (daysLeft < 14) {
        lowStockCount++
      } else if (daysLeft > 180) {
        overStockCount++
      } else {
        healthyStockCount++
      }
    }

    return {
      summary: {
        totalProducts,
        totalVariants: totalVariantsCount,
        totalUnits,
        deadStockCount,
        lowStockCount,
        healthyStockCount,
        overStockCount,
        avgSellThroughRate: totalProducts > 0 ? Math.round((sellThroughSum / totalProducts) * 100) / 100 : null,
        avgDaysLeft: daysLeftCount > 0 ? Math.round(daysLeftSum / daysLeftCount) : null,
      },
    }
  } catch (e) {
    console.error('[ai-calc/inventory] Error computing inventory:', e)
    return null
  }
}
