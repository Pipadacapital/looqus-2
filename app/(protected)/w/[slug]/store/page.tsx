import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { StoreContent } from './store-content'

export default async function StorePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

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
