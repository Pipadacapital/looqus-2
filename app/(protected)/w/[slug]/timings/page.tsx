import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { TimingsContent } from './timings-content'

export default async function TimingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // Layout already validated auth — no duplicate auth.getUser() needed here.
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
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

  if (!workspace) redirect('/')

  const connection = workspace.shopifyConnections[0] ?? null

  return (
    <TimingsContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
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
