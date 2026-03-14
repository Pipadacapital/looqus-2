import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { GoogleAdsContent } from './google-ads-content'

export default async function GoogleAdsPage({
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
      google_ads_connections: {
        where: { status: 'CONNECTED' },
        select: { id: true, customer_ids: true, selected_customer_id: true },
      },
    },
  })

  if (!workspace) redirect('/')

  return (
    <GoogleAdsContent
      hasConnection={!!workspace.google_ads_connections}
      workspaceId={workspace.id}
    />
  )
}
