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
    include: {
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!workspace) redirect('/')

  const hasConnection = workspace.shopifyConnections.length > 0

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
          Connect a Shopify store from the Dashboard to set product COQs.
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
        <h1 className="text-2xl font-semibold tracking-tight">Product COQs</h1>
        <p className="text-muted-foreground text-sm">
          Set cost of quality (COQ) for each product. You can add more targets
          here later.
        </p>
      </div>
      <CoqsContent />
    </div>
  )
}
