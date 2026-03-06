import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { PnlContent } from './pnl-content'

export default async function PnlPage({
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
        select: { id: true, shopDomain: true, status: true },
        take: 1,
      },
    },
  })

  if (!workspace) redirect('/')

  const connection = workspace.shopifyConnections[0] ?? null

  return (
    <PnlContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
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
