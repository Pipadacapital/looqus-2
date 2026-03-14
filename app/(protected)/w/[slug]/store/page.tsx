import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { StoreContent } from './store-content'

export default async function StorePage({
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
        select: { id: true, lastSyncAt: true },
        take: 1,
      },
    },
  })

  if (!workspace) redirect('/')

  const hasConnection = workspace.shopifyConnections.length > 0
  const connection = workspace.shopifyConnections[0] ?? null

  return (
    <StoreContent
      hasConnection={hasConnection}
      connectionId={connection?.id ?? null}
      lastSyncAt={connection?.lastSyncAt?.toISOString() ?? null}
    />
  )
}
