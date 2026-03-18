import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { IntegrationsLoader } from './integrations-loader'
import Loading from './loading'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/server'

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // const workspace = await getCachedWorkspace(slug)
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
        select: {
          id: true,
          shopDomain: true,
          status: true,
          installedAt: true,
          lastSyncAt: true,
          scopes: true,
        },
        take: 1,
      },
      meta_ads_connections: {
        select: {
          id: true,
          ad_account_ids: true,
          selected_ad_account_id: true,
          selected_ad_account_ids: true,
          meta_user_id: true,
          status: true,
          last_sync_at: true,
          last_sync_error: true,
          created_at: true,
        },
      },
      google_ads_connections: {
        select: {
          id: true,
          customer_ids: true,
          selected_customer_id: true,
          selected_customer_ids: true,
          google_email: true,
          status: true,
          last_sync_at: true,
          last_sync_error: true,
          created_at: true,
        },
      },
      shiprocketConnection: {
        select: {
          id: true,
          email: true,
          status: true,
          lastSyncAt: true,
          lastSyncError: true,
          createdAt: true,
        },
      },
      klaviyoConnection: {
        select: {
          id: true,
          status: true,
          lastSyncAt: true,
          lastSyncError: true,
          createdAt: true,
        },
      },
    },
  })

  if (!workspace) redirect('/')

  return (
    <Suspense fallback={<Loading />}>
      <IntegrationsLoader slug={slug} />
    </Suspense>
  )
}
