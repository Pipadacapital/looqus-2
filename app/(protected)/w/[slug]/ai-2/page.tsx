import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import AiInsightsV2 from './ai-insights-v2'


export default async function AiPage2({
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
    <AiInsightsV2
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}