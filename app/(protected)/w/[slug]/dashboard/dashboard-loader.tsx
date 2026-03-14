import { prisma } from '@/lib/prisma'
import { getCurrentUserRole } from '@/lib/require-superadmin'
import { DashboardContent } from './dashboard-content'

export async function DashboardLoader({
  slug,
  connectionError,
}: {
  slug: string
  connectionError: string | null
}) {
  const [workspace, role] = await Promise.all([
    prisma.workspace.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
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
      },
    }),
    getCurrentUserRole(),
  ])

  if (!workspace) return null

  const isSuperadmin = role === 'SUPERADMIN'
  const connection = workspace.shopifyConnections[0] ?? null
  const metaConnectionRaw = workspace.meta_ads_connections
  const metaConnection =
    metaConnectionRaw?.status === 'CONNECTED' ? metaConnectionRaw : null
  const googleConnectionRaw = workspace.google_ads_connections
  const googleConnection =
    googleConnectionRaw?.status === 'CONNECTED' ? googleConnectionRaw : null
  const shiprocketRaw = workspace.shiprocketConnection
  const shiprocketConnection =
    shiprocketRaw?.status === 'CONNECTED' ? shiprocketRaw : null

  return (
    <DashboardContent
      workspaceSlug={slug}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      isSuperadmin={isSuperadmin}
      connectionError={connectionError}
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
              adAccountIds: metaConnection.ad_account_ids,
              selectedAdAccountId: metaConnection.selected_ad_account_id,
              selectedAdAccountIds: metaConnection.selected_ad_account_ids,
              metaUserId: metaConnection.meta_user_id,
              status: metaConnection.status,
              lastSyncAt: metaConnection.last_sync_at?.toISOString() ?? null,
              lastSyncError: metaConnection.last_sync_error,
              createdAt: metaConnection.created_at.toISOString(),
            }
          : null
      }
      googleConnection={
        googleConnection
          ? {
              id: googleConnection.id,
              customerIds: googleConnection.customer_ids,
              selectedCustomerId: googleConnection.selected_customer_id,
              selectedCustomerIds: googleConnection.selected_customer_ids,
              googleEmail: googleConnection.google_email,
              status: googleConnection.status,
              lastSyncAt: googleConnection.last_sync_at?.toISOString() ?? null,
              lastSyncError: googleConnection.last_sync_error,
              createdAt: googleConnection.created_at.toISOString(),
            }
          : null
      }
      shiprocketConnection={
        shiprocketConnection
          ? {
              id: shiprocketConnection.id,
              email: shiprocketConnection.email,
              status: shiprocketConnection.status,
              lastSyncAt: shiprocketConnection.lastSyncAt?.toISOString() ?? null,
              lastSyncError: shiprocketConnection.lastSyncError,
              createdAt: shiprocketConnection.createdAt.toISOString(),
            }
          : null
      }
    />
  )
}
