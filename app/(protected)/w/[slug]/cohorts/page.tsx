import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { CohortsContent } from './cohorts-content'

export default async function CohortsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // Layout already validated auth. getCachedWorkspace returns the cached result
  // from the layout DB call — no extra DB round-trip here.
  const workspace = await getCachedWorkspace(slug)

  if (!workspace) redirect('/')

  return (
    <CohortsContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}
