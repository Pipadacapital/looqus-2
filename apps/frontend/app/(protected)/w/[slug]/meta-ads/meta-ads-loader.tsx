import { prisma } from '@/lib/prisma'
import { MetaAdsContent } from './meta-ads-content'

export async function MetaAdsLoader({ slug }: { slug: string }) {
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

  return (
    <MetaAdsContent
      hasConnection={!!workspace?.meta_ads_connections}
      workspaceId={workspace?.id ?? ''}
    />
  )
}
