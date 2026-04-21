import { prisma } from '@/lib/prisma'
import { PnlContent } from './pnl-content'

export async function PnlLoader({ slug }: { slug: string }) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      name: true,
      platform: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true, shopDomain: true, status: true },
        take: 1,
      },
      woocommerceConnection: {
        select: {
          id: true,
          status: true,
          storeUrl: true,
        },
      },
    },
  })

  const connection = workspace?.shopifyConnections[0] ?? null
  const hasWooConnection = workspace?.woocommerceConnection?.status === 'CONNECTED'
  const hasStoreConnection =
    workspace?.platform === 'WOOCOMMERCE' ? hasWooConnection : !!connection

  return (
    <PnlContent
      workspaceSlug={slug}
      workspaceName={workspace?.name ?? ''}
      workspacePlatform={workspace?.platform ?? 'SHOPIFY'}
      hasStoreConnection={hasStoreConnection}
      shopifyConnection={
        connection
          ? {
              id: connection.id,
              shopDomain: connection.shopDomain,
              status: connection.status,
            }
          : null
      }
    />
  )
}
