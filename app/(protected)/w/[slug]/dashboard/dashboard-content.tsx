'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'

type ShopifyConnectionInfo = {
  id: string
  shopDomain: string
  status: string
  installedAt: string
  lastSyncAt: string | null
}

type MetaConnectionInfo = {
  id: string
  adAccountIds: string[]
  selectedAdAccountId: string | null
  selectedAdAccountIds: string[]
  metaUserId: string | null
  status: string
  lastSyncAt: string | null
  lastSyncError: string | null
  createdAt: string
}

type GoogleConnectionInfo = {
  id: string
  customerIds: string[]
  selectedCustomerId: string | null
  selectedCustomerIds: string[]
  googleEmail: string | null
  status: string
  lastSyncAt: string | null
  lastSyncError: string | null
  createdAt: string
}

type ShiprocketConnectionInfo = {
  id: string
  email: string
  status: string
  lastSyncAt: string | null
  lastSyncError: string | null
  createdAt: string
}

interface DashboardContentProps {
  workspaceSlug: string
  workspaceId: string
  workspaceName: string
  isSuperadmin?: boolean
  connectionError?: string | null
  shopifyConnection: ShopifyConnectionInfo | null
  metaConnection: MetaConnectionInfo | null
  googleConnection: GoogleConnectionInfo | null
  shiprocketConnection: ShiprocketConnectionInfo | null
}

export function DashboardContent({
  workspaceSlug,
  workspaceId,
  workspaceName,
  isSuperadmin = false,
  connectionError = null,
  shopifyConnection,
  metaConnection,
  googleConnection,
  shiprocketConnection,
}: DashboardContentProps) {
  const connectedCount = [
    shopifyConnection,
    metaConnection,
    googleConnection,
    shiprocketConnection,
  ].filter(Boolean).length

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {workspaceName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Welcome to your workspace dashboard.
        </p>
      </div>

      {connectionError && (connectionError === 'state_mismatch' || connectionError === 'shop_mismatch') && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Shopify connection could not be completed. Try again from{' '}
          <Link href={`/w/${workspaceSlug}/settings/integrations`} className="font-medium underline underline-offset-2">
            Settings → Integrations
          </Link>
          .
        </div>
      )}

      {/* Integrations summary — manage in Settings > Integrations */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-medium">Integrations</p>
            <p className="text-xs text-muted-foreground">
              {connectedCount === 0
                ? 'No integrations connected yet'
                : `${connectedCount} of 4 connected`}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/w/${workspaceSlug}/settings/integrations`}>
              Manage
            </Link>
          </Button>
        </div>
      </div>

    </div>
  )
}
