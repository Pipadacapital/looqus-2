import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { MetaAdsContent } from './meta-ads-content'

export default async function MetaAdsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // Layout already validated auth and membership — no duplicate checks needed.
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      meta_ads_connections: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          ad_account_ids: true,
          selected_ad_account_id: true,
        },
      },
    },
  })

  if (!workspace) redirect('/')

  return (
    <MetaAdsContent
      hasConnection={!!workspace.meta_ads_connections}
      workspaceId={workspace.id}
    />
  )
}
