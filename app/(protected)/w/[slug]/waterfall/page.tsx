import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { WaterfallContent } from './waterfall-content'

export default async function WaterfallPage({
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
    select: { id: true, name: true },
  })

  if (!workspace) redirect('/')

  return (
    <WaterfallContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}
