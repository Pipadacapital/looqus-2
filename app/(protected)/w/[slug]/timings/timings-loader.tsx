import { prisma } from '@/lib/prisma'
import { TimingsContent } from './timings-content'

export async function TimingsLoader({ slug }: { slug: string }) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      name: true,
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
    },
  })

  const connection = workspace?.shopifyConnections[0] ?? null

  return (
    <TimingsContent
      workspaceSlug={slug}
      workspaceName={workspace?.name ?? ''}
      shopifyConnection={
        connection
          ? {
              id: connection.id,
              shopDomain: connection.shopDomain,
              status: connection.status,
              lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
            }
          : null
      }
    />
  )
}
