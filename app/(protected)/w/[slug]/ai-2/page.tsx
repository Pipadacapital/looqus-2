import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import AiInsightsV2 from './ai-insights-v2'

export default async function AiPage2({
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
    <AiInsightsV2
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}
