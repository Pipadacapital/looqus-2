import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getCurrentUserRole } from '@/lib/require-superadmin'
import { IntegrationsContent } from './integrations-content'
import { hasRole, type WorkspaceRole } from '@/lib/features'
import { fetchMetaAdAccountNames } from '@/lib/integrations/meta'
import {
  fetchGoogleCustomerNames,
  refreshGoogleAccessToken,
} from '@/lib/integrations/google'

export default async function IntegrationsPage({
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
      name: true,
      platform: true,
      productDataSource: true,
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
          access_token: true,
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
          refresh_token: true,
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
          shiprocketApiEmail: true,
          status: true,
          lastSyncAt: true,
          lastSyncError: true,
          createdAt: true,
        },
      },
      unicommerceConnection: {
        select: {
          id: true,
          tenant: true,
          username: true,
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
      woocommerceConnection: {
        select: {
          id: true,
          storeUrl: true,
          status: true,
          lastSyncAt: true,
          lastSyncError: true,
          createdAt: true,
        },
      },
    },
  })

  if (!workspace) redirect('/')

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: workspace.id, userId: user.id },
    select: { role: true },
  })
  if (!membership) redirect('/')
  if (!hasRole(membership.role as WorkspaceRole, 'MANAGER')) {
    redirect(`/w/${slug}/settings`)
  }

  const role = await getCurrentUserRole()
  const isSuperadmin = role === 'SUPERADMIN'

  const connection = workspace.shopifyConnections[0] ?? null
  const metaConnectionRaw = workspace.meta_ads_connections
  const metaConnection =
    metaConnectionRaw?.status === 'CONNECTED' ? metaConnectionRaw : null
  const googleConnectionRaw = workspace.google_ads_connections
  const googleConnection =
    googleConnectionRaw?.status === 'CONNECTED' ? googleConnectionRaw : null
  let metaAccountNames: Record<string, string> = {}
  let googleCustomerNames: Record<string, string> = {}

  if (metaConnection && metaConnection.access_token && metaConnection.ad_account_ids.length > 0) {
    try {
      metaAccountNames = await fetchMetaAdAccountNames(
        metaConnection.access_token,
        metaConnection.ad_account_ids
      )
    } catch {
      metaAccountNames = {}
    }
  }

  if (googleConnection && googleConnection.refresh_token && googleConnection.customer_ids.length > 0) {
    try {
      const { accessToken } = await refreshGoogleAccessToken(
        googleConnection.refresh_token
      )
      googleCustomerNames = await fetchGoogleCustomerNames(
        accessToken,
        googleConnection.customer_ids
      )
    } catch {
      googleCustomerNames = {}
    }
  }

  const shiprocketRaw = workspace.shiprocketConnection
  const shiprocketConnection =
    shiprocketRaw?.status === 'CONNECTED' ? shiprocketRaw : null
  const unicommerceRaw = workspace.unicommerceConnection
  const unicommerceConnection =
    unicommerceRaw?.status === 'CONNECTED' ? unicommerceRaw : null

  return (
    <IntegrationsContent
      workspaceSlug={slug}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      workspacePlatform={workspace.platform}
      isSuperadmin={isSuperadmin}
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
              adAccountNames: metaAccountNames,
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
              customerNames: googleCustomerNames,
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
              shiprocketApiEmail: shiprocketConnection.shiprocketApiEmail,
              status: shiprocketConnection.status,
              lastSyncAt: shiprocketConnection.lastSyncAt?.toISOString() ?? null,
              lastSyncError: shiprocketConnection.lastSyncError,
              createdAt: shiprocketConnection.createdAt.toISOString(),
            }
          : null
      }
      unicommerceConnection={
        unicommerceConnection
          ? {
              id: unicommerceConnection.id,
              tenant: unicommerceConnection.tenant,
              username: unicommerceConnection.username,
              status: unicommerceConnection.status,
              lastSyncAt: unicommerceConnection.lastSyncAt?.toISOString() ?? null,
              lastSyncError: unicommerceConnection.lastSyncError,
              createdAt: unicommerceConnection.createdAt.toISOString(),
            }
          : null
      }
      productDataSource={workspace.productDataSource}
      klaviyoConnection={
        workspace.klaviyoConnection
          ? {
              id: workspace.klaviyoConnection.id,
              status: workspace.klaviyoConnection.status,
              lastSyncAt: workspace.klaviyoConnection.lastSyncAt?.toISOString() ?? null,
              lastSyncError: workspace.klaviyoConnection.lastSyncError,
              createdAt: workspace.klaviyoConnection.createdAt.toISOString(),
            }
          : null
      }
      woocommerceConnection={
        workspace.woocommerceConnection?.status === 'CONNECTED'
          ? {
              id: workspace.woocommerceConnection.id,
              storeUrl: workspace.woocommerceConnection.storeUrl,
              status: workspace.woocommerceConnection.status,
              lastSyncAt: workspace.woocommerceConnection.lastSyncAt?.toISOString() ?? null,
              lastSyncError: workspace.woocommerceConnection.lastSyncError,
              createdAt: workspace.woocommerceConnection.createdAt.toISOString(),
            }
          : null
      }
    />
  )
}