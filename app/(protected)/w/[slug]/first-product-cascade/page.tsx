import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { FirstProductCascadeContent } from './first-product-cascade-content'

export default async function FirstProductCascadePage({
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
    <FirstProductCascadeContent workspaceSlug={slug} workspaceName={workspace.name} />
  )
}
