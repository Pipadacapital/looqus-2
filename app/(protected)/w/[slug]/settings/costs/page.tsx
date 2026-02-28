import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { CostsContent } from './costs-content'

export default async function CostsPage({
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
    where: {
      workspace: { slug },
      userId: user.id,
    },
    select: { role: true },
  })

  const isOwner = membership?.role === 'OWNER'

  return <CostsContent slug={slug} isOwner={isOwner} />
}
