import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { AcquisitionContent } from './acquisition-content'

export default async function AcquisitionPage({
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
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!workspace) redirect('/')

  return (
    <AcquisitionContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
      hasShopifyConnection={!!workspace.shopifyConnections?.[0]}
    />
  )
}
