import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { GoogleAdsContent } from './google-ads-content'

export default async function GoogleAdsPage({
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
    select: {
      id: true,
      google_ads_connections: {
        where: { status: 'CONNECTED' },
        select: { id: true, customer_ids: true, selected_customer_id: true },
      },
    },
  })

  if (!workspace) redirect('/')

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })

  if (!membership) redirect('/')

  return (
    <GoogleAdsContent
      hasConnection={!!workspace.google_ads_connections}
      workspaceId={workspace.id}
    />
  )
}
