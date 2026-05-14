import { prisma } from '@/lib/prisma'

export interface ResolvedProduct {
  skuCode: string
  name: string
  brand: string | null
  mrp: number | null
  imageUrl: string | null
  inventory: number | null
}

/**
 * Returns a map of skuCode → ResolvedProduct from Unicommerce.
 * Only returns SKUs that exist in unicommerce_products for this workspace.
 */
export async function getUnicommerceProductMap(
  workspaceId: string
): Promise<Map<string, ResolvedProduct>> {
  const connection = await prisma.unicommerceConnection.findUnique({
    where: { workspaceId },
    select: { id: true },
  })
  if (!connection) return new Map()

  const products = await prisma.unicommerceProduct.findMany({
    where: { connectionId: connection.id, enabled: true },
    select: {
      skuCode: true,
      name: true,
      brand: true,
      mrp: true,
      imageUrl: true,
      inventory: true,
    },
  })

  const map = new Map<string, ResolvedProduct>()
  for (const p of products) {
    map.set(p.skuCode, {
      skuCode: p.skuCode,
      name: p.name,
      brand: p.brand,
      mrp: p.mrp ? Number(p.mrp) : null,
      imageUrl: p.imageUrl,
      inventory: p.inventory,
    })
  }
  return map
}

/**
 * Check if workspace has Unicommerce as product data source.
 */
export async function isUnicommerceActive(workspaceId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { productDataSource: true },
  })
  return workspace?.productDataSource === 'UNICOMMERCE'
}
