import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { AiInsightsContent } from './ai-insights-content'

export default async function AiPage({
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
    <AiInsightsContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}
