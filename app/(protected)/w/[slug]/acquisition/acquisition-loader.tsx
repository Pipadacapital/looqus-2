import { prisma } from '@/lib/prisma'
import { AcquisitionContent } from './acquisition-content'

export async function AcquisitionLoader({ slug }: { slug: string }) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      name: true,
      platform: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
      woocommerceConnection: {
        where: { status: 'CONNECTED' },
        select: { id: true },
      },
    },
  })

  const hasStoreConnection =
    workspace?.platform === 'WOOCOMMERCE'
      ? !!workspace?.woocommerceConnection?.id
      : !!workspace?.shopifyConnections?.[0]

  return (
    <AcquisitionContent
      workspaceSlug={slug}
      workspaceName={workspace?.name ?? ''}
      hasStoreConnection={hasStoreConnection}
    />
  )
}
