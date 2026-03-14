import { prisma } from '@/lib/prisma'
import { StoreContent } from './store-content'

export async function StoreLoader({ slug }: { slug: string }) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true, lastSyncAt: true },
        take: 1,
      },
    },
  })

  const connection = workspace?.shopifyConnections[0] ?? null

  return (
    <StoreContent
      hasConnection={!!connection}
      connectionId={connection?.id ?? null}
      lastSyncAt={connection?.lastSyncAt?.toISOString() ?? null}
    />
  )
}
