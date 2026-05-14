import { prisma } from '@/lib/prisma'
import { GoogleAdsContent } from './google-ads-content'

export async function GoogleAdsLoader({ slug }: { slug: string }) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      google_ads_connections: {
        where: { status: 'CONNECTED' },
        select: { id: true, customer_ids: true, selected_customer_id: true },
      },
    },
  })

  return (
    <GoogleAdsContent
      hasConnection={!!workspace?.google_ads_connections}
      workspaceId={workspace?.id ?? ''}
    />
  )
}
