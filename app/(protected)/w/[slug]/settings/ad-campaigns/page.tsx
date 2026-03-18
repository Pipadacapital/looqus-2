import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { AdCampaignsContent } from './ad-campaigns-content'

export default async function AdCampaignsPage({
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

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspace: { slug }, userId: user.id },
    select: { role: true },
  })
  if (!membership) redirect('/w')

  return <AdCampaignsContent slug={slug} isOwner={membership.role === 'OWNER'} />
}
