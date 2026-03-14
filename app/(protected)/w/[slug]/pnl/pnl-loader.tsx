import { prisma } from '@/lib/prisma'
import { PnlContent } from './pnl-content'

export async function PnlLoader({ slug }: { slug: string }) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      name: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true, shopDomain: true, status: true },
        take: 1,
      },
    },
  })

  const connection = workspace?.shopifyConnections[0] ?? null

  return (
    <PnlContent
      workspaceSlug={slug}
      workspaceName={workspace?.name ?? ''}
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
