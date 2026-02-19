import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { DashboardContent } from './dashboard-content'

export default async function DashboardPage({
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
      metaAdsConnections: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          adAccountIds: true,
          selectedAdAccountId: true,
          metaUserId: true,
          status: true,
          lastSyncAt: true,
          lastSyncError: true,
          createdAt: true,
        },
        take: 1,
      },
      googleAdsConnections: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          customerIds: true,
          selectedCustomerId: true,
          googleEmail: true,
          status: true,
          lastSyncAt: true,
          lastSyncError: true,
          createdAt: true,
        },
        take: 1,
      },
    },
  })

  if (!workspace) redirect('/')

  const connection = workspace.shopifyConnections[0] ?? null
  const metaConnection = workspace.metaAdsConnections[0] ?? null
  const googleConnection = workspace.googleAdsConnections[0] ?? null

  return (
    <DashboardContent
      workspaceSlug={slug}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      shopifyConnection={
        connection
          ? {
              id: connection.id,
              shopDomain: connection.shopDomain,
              status: connection.status,
              installedAt: connection.installedAt.toISOString(),
              lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
            }
          : null
      }
      metaConnection={
        metaConnection
          ? {
              id: metaConnection.id,
              adAccountIds: metaConnection.adAccountIds,
              selectedAdAccountId: metaConnection.selectedAdAccountId,
              metaUserId: metaConnection.metaUserId,
              status: metaConnection.status,
              lastSyncAt: metaConnection.lastSyncAt?.toISOString() ?? null,
              lastSyncError: metaConnection.lastSyncError,
              createdAt: metaConnection.createdAt.toISOString(),
            }
          : null
      }
      googleConnection={
        googleConnection
          ? {
              id: googleConnection.id,
              customerIds: googleConnection.customerIds,
              selectedCustomerId: googleConnection.selectedCustomerId,
              googleEmail: googleConnection.googleEmail,
              status: googleConnection.status,
              lastSyncAt: googleConnection.lastSyncAt?.toISOString() ?? null,
              lastSyncError: googleConnection.lastSyncError,
              createdAt: googleConnection.createdAt.toISOString(),
            }
          : null
      }
    />
  )
}
