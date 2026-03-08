import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
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
    <ProductsContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  )
}
