import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { ProductsContent } from './products-content'

export const metadata = {
  title: 'Products',
  description: 'Product analytics and profitability by group',
}

export default async function ProductsPage({
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
    <ProductsContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}
