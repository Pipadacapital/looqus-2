import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CoqsContent } from './coqs-content'
import { Button } from '@/components/ui/button'
import { IconArrowLeft } from '@tabler/icons-react'

export default async function StoreCoqsPage({
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
    select: {
      id: true,
      platform: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
      woocommerceConnection: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  })

  if (!workspace) redirect('/')

  const hasConnection =
    workspace.platform === 'WOOCOMMERCE'
      ? workspace.woocommerceConnection?.status === 'CONNECTED'
      : workspace.shopifyConnections.length > 0

  if (!hasConnection) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/w/${slug}/store`}>
            <IconArrowLeft className="size-4" />
            Back to Store
          </Link>
        </Button>
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          Connect a {workspace.platform === 'WOOCOMMERCE' ? 'WooCommerce' : 'Shopify'} store from Integrations to set product COGS.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/w/${slug}/store`}>
            <IconArrowLeft className="size-4" />
            Back to Store
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Product COGS</h1>
        <p className="text-muted-foreground text-sm">
          Set Cost of Goods Sold (COGS) for each product. Filter by status or
          &quot;COGS not set&quot; to focus on products that need values. Use Enter in
          the COGS field to save and jump to the next row.
        </p>
      </div>
      <CoqsContent />
    </div>
  )
}
