import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { LifetimeValueContent } from './lifetime-value-content'

export default async function LifetimeValuePage({
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
    <LifetimeValueContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}
