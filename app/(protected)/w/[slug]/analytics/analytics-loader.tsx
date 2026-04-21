import { prisma } from '@/lib/prisma'
import { AnalyticsContent } from './analytics-content'

export async function AnalyticsLoader({ slug }: { slug: string }) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      name: true,
      platform: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          shopDomain: true,
          status: true,
          lastSyncAt: true,
        },
        take: 1,
      },
      woocommerceConnection: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          storeUrl: true,
          status: true,
          lastSyncAt: true,
        },
      },
    },
  })

  const connection =
    workspace?.platform === 'WOOCOMMERCE'
      ? workspace?.woocommerceConnection
        ? {
            id: workspace.woocommerceConnection.id,
            shopDomain: workspace.woocommerceConnection.storeUrl ?? 'WooCommerce',
            status: workspace.woocommerceConnection.status,
            lastSyncAt: workspace.woocommerceConnection.lastSyncAt?.toISOString() ?? null,
          }
        : null
      : workspace?.shopifyConnections[0]
        ? {
            id: workspace.shopifyConnections[0].id,
            shopDomain: workspace.shopifyConnections[0].shopDomain,
            status: workspace.shopifyConnections[0].status,
            lastSyncAt: workspace.shopifyConnections[0].lastSyncAt?.toISOString() ?? null,
          }
        : null

  return (
    <AnalyticsContent
      workspaceSlug={slug}
      workspaceName={workspace?.name ?? ''}
      shopifyConnection={connection}
    />
  )
}
