'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StoreOrdersTable } from './store-orders-table'
import { StoreProductsTable } from './store-products-table'
import { StoreCustomersTable } from './store-customers-table'
import { IconShoppingCart, IconPackage, IconUsers } from '@tabler/icons-react'

export function StoreContent({
  hasConnection,
}: {
  hasConnection: boolean
}) {
  if (!hasConnection) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Connect a Shopify store from the Dashboard to view orders, products, and
        customers here.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Store data</h1>
        <p className="text-muted-foreground text-sm">
          Orders, products, and customers synced from your connected store.
        </p>
      </div>

      <Tabs defaultValue="orders" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
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
        </TabsList>
        <TabsContent value="orders" className="mt-6">
          <StoreOrdersTable />
        </TabsContent>
        <TabsContent value="products" className="mt-6">
          <StoreProductsTable />
        </TabsContent>
        <TabsContent value="customers" className="mt-6">
          <StoreCustomersTable />
        </TabsContent>
      </Tabs>
    </div>
  )
}
