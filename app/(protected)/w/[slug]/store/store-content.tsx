'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Link from 'next/link'
import { toast } from 'sonner'
import { StoreOrdersTable } from './store-orders-table'
import type { OrdersResponse } from './store-orders-table'
import { StoreProductsTable } from './store-products-table'
import { StoreCustomersTable } from './store-customers-table'
import {
  IconShoppingCart,
  IconPackage,
  IconUsers,
  IconTargetArrow,
  IconRefresh,
  IconLoader2,
  IconDatabaseImport,
} from '@tabler/icons-react'
import { useWorkspace } from '@/hooks/use-workspace'
import { Button } from '@/components/ui/button'

export function StoreContent({
  platform,
  hasConnection,
  connectionId,
  lastSyncAt,
  initialOrders,
}: {
  platform: 'SHOPIFY' | 'WOOCOMMERCE'
  hasConnection: boolean
  connectionId: string | null
  lastSyncAt: string | null
  initialOrders?: OrdersResponse
}) {
  const { current } = useWorkspace()
  const slug = current.slug
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [customerBackfilling, setCustomerBackfilling] = useState(false)
  const isWoocommerce = platform === 'WOOCOMMERCE'

  const handleRefreshFromStore = async () => {
    setSyncing(true)
    try {
      const res = await fetch(
        isWoocommerce ? '/api/integrations/woocommerce/sync' : '/api/shopify/sync',
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isWoocommerce ? { workspaceId: current.id } : { connectionId }
          ),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? `${isWoocommerce ? 'WooCommerce' : 'Shopify'} sync failed`)
        return
      }
      if (isWoocommerce) {
        toast.success(
          `Synced ${data.ordersUpserted ?? 0} orders, ${data.lineItemsUpserted ?? 0} line items`
        )
      } else {
        toast.success(
          `Synced ${data.products ?? 0} products, ${data.orders ?? 0} orders, ${data.customers ?? 0} customers`
        )
      }
      queryClient.invalidateQueries({ queryKey: ['store', 'products', slug] })
    } finally {
      setSyncing(false)
    }
  }

  const startBackfill = async (resources?: Array<'customers' | 'products' | 'orders'>) => {
    if (!connectionId) return
    try {
      const res = await fetch(`/api/workspaces/${slug}/shopify/bulk-backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resources ? { resources } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Bulk backfill failed to start')
        return
      }
      const label = resources?.join(', ') ?? 'all resources'
      toast.success(`Backfill started for ${label}. You'll be notified when it completes.`)
    } catch {
      toast.error('Failed to start bulk backfill')
    }
  }

  const handleBulkBackfill = async () => {
    setBackfilling(true)
    try {
      await startBackfill()
    } finally {
      setBackfilling(false)
    }
  }

  const handleCustomerBackfill = async () => {
    setCustomerBackfilling(true)
    try {
      await startBackfill(['customers'])
    } finally {
      setCustomerBackfilling(false)
    }
  }

  if (!hasConnection) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Connect a {isWoocommerce ? 'WooCommerce' : 'Shopify'} store from Integrations
        to view orders, products, and customers here.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Store data</h1>
          <p className="text-muted-foreground text-sm">
            Orders, products, and customers synced from your connected store.
            {lastSyncAt && (
              <span className="ml-1">
                Last synced: {new Date(lastSyncAt).toLocaleString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isWoocommerce && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCustomerBackfill}
                disabled={customerBackfilling || syncing || backfilling}
              >
                {customerBackfilling ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconUsers className="size-4" />
                )}
                <span className="ml-2">Backfill Customers</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkBackfill}
                disabled={backfilling || syncing || customerBackfilling}
              >
                {backfilling ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconDatabaseImport className="size-4" />
                )}
                <span className="ml-2">Bulk Backfill (4 Years)</span>
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshFromStore}
            disabled={syncing || backfilling || customerBackfilling}
          >
            {syncing ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconRefresh className="size-4" />
            )}
            <span className="ml-2">Refresh from {isWoocommerce ? 'WooCommerce' : 'Shopify'}</span>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="orders" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-4">
          <TabsTrigger value="orders" className="gap-2">
            <IconShoppingCart className="size-4" />
            Orders
          </TabsTrigger>
          <TabsTrigger value="products" className="gap-2">
            <IconPackage className="size-4" />
            Products
          </TabsTrigger>
          <TabsTrigger value="customers" className="gap-2">
            <IconUsers className="size-4" />
            Customers
          </TabsTrigger>
          <TabsTrigger value="coqs" asChild>
            <Link href={`/w/${slug}/store/coqs`} className="flex items-center gap-2">
              <IconTargetArrow className="size-4" />
              Product COGS
            </Link>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="mt-6">
          <StoreOrdersTable initialOrders={initialOrders} />
        </TabsContent>
        <TabsContent value="products" className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              View and manage products. Set cost of quality (COQ) per product on
              the{' '}
              <Link
                href={`/w/${slug}/store/coqs`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Product COQs
              </Link>{' '}
              page.
            </p>
          </div>
          <StoreProductsTable />
        </TabsContent>
        <TabsContent value="customers" className="mt-6">
          <StoreCustomersTable />
        </TabsContent>
      </Tabs>
    </div>
  )
}
