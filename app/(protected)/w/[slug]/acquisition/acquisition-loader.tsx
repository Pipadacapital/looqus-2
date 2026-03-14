import { prisma } from '@/lib/prisma'
import { AcquisitionContent } from './acquisition-content'

export async function AcquisitionLoader({ slug }: { slug: string }) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      name: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
    },
  })

  return (
    <AcquisitionContent
      workspaceSlug={slug}
      workspaceName={workspace?.name ?? ''}
      hasShopifyConnection={!!workspace?.shopifyConnections?.[0]}
    />
  )
}
