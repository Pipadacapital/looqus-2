import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { DistributionsContent } from './distributions-content'

export const metadata = {
  title: 'Distributions',
  description: 'Product-level distribution of CM1 and Sales per order',
}

export default async function DistributionsPage({
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
    <DistributionsContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}
