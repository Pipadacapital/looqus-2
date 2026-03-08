import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { LifetimeValueContent } from './lifetime-value-content'

export default async function LifetimeValuePage({
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
    select: { name: true },
  })

  if (!workspace) redirect('/')

  return (
    <LifetimeValueContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}
