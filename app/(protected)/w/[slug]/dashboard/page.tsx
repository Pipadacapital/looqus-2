import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { DashboardContent } from './dashboard-content'

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { slug } = await params
  const { error: connectionError } = await searchParams

  const workspace = await getCachedWorkspace(slug)
  if (!workspace) redirect('/')

  return (
    <DashboardContent
      workspaceSlug={slug}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      connectionError={connectionError ?? null}
    />
  )
}
