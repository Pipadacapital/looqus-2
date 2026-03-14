import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
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

  // Layout already validated auth. getCachedWorkspace returns the cached result
  // from the layout DB call — no extra DB round-trip here.
  const workspace = await getCachedWorkspace(slug)

  if (!workspace) redirect('/')

  return (
    <DistributionsContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}
