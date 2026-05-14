import { redirect } from 'next/navigation'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: { select: { slug: true } } },
    orderBy: { joinedAt: 'asc' },
  })

  if (membership) {
    redirect(`/w/${membership.workspace.slug}/dashboard`)
  }

  redirect('/onboarding')
}
