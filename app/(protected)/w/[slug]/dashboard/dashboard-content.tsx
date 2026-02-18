'use client'

import { useState } from 'react'
import {
  IconPlugConnected,
  IconCheck,
  IconExternalLink,
  IconRefresh,
  IconArrowRight,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatDistanceToNow } from 'date-fns'

type ShopifyConnectionInfo = {
  id: string
  shopDomain: string
  status: string
  installedAt: string
  lastSyncAt: string | null
}

interface DashboardContentProps {
  workspaceSlug: string
  workspaceName: string
  shopifyConnection: ShopifyConnectionInfo | null
}

export function DashboardContent({
  workspaceSlug,
  workspaceName,
  shopifyConnection,
}: DashboardContentProps) {
  const [storeHandle, setStoreHandle] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleConnect = () => {
    const cleaned = storeHandle
      .trim()
      .toLowerCase()
      .replace(/\.myshopify\.com$/, '')
      .replace(/^https?:\/\//, '')
      .split('/')[0]

    if (!cleaned) return

    window.location.href = `/api/shopify/auth?shop=${encodeURIComponent(
      cleaned + '.myshopify.com'
    )}&workspaceSlug=${encodeURIComponent(workspaceSlug)}`
  }

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

      {/* Shopify Connection Card */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#96bf48]/10">
            <IconPlugConnected className="h-5 w-5 text-[#96bf48]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Shopify Connection</p>
            <p className="text-xs text-muted-foreground">
              {shopifyConnection
                ? 'Your store is connected'
                : 'Connect your Shopify store to start syncing data'}
            </p>
          </div>
          {shopifyConnection ? (
            <Badge
              variant="secondary"
              className="bg-emerald-500/10 text-emerald-600"
            >
              <IconCheck className="mr-1 h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
        </div>

        <div className="px-6 py-4">
          {shopifyConnection ? (
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {shopifyConnection.shopDomain}
                </p>
                <p className="text-xs text-muted-foreground">
                  Connected{' '}
                  {formatDistanceToNow(new Date(shopifyConnection.installedAt), {
                    addSuffix: true,
                  })}
                  {shopifyConnection.lastSyncAt && (
                    <>
                      {' · '}Last synced{' '}
                      {formatDistanceToNow(
                        new Date(shopifyConnection.lastSyncAt),
                        { addSuffix: true }
                      )}
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled>
                  <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
                  Sync now
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`https://${shopifyConnection.shopDomain}/admin`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <IconExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Shopify Admin
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="max-w-sm space-y-1">
                <p className="text-sm font-medium">No store connected yet</p>
                <p className="text-xs text-muted-foreground">
                  Connect your Shopify store to pull in orders, products, and
                  customer data for analytics.
                </p>
              </div>

              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <IconPlugConnected className="mr-1.5 h-4 w-4" />
                    Connect Shopify store
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Connect your Shopify store</DialogTitle>
                    <DialogDescription>
                      Enter your store handle and we&apos;ll redirect you to
                      Shopify to authorize access.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-3 py-2">
                    <Label htmlFor="store-handle">Store URL</Label>
                    <div className="flex items-center">
                      <Input
                        id="store-handle"
                        placeholder="your-store"
                        value={storeHandle}
                        onChange={(e) => setStoreHandle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && storeHandle.trim()) {
                            handleConnect()
                          }
                        }}
                        className="rounded-r-none"
                        autoFocus
                      />
                      <span className="flex h-9 items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">
                        .myshopify.com
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      You can find this in your Shopify admin URL, e.g.{' '}
                      <span className="font-medium">your-store</span>
                      .myshopify.com
                    </p>
                  </div>

                  <DialogFooter>
                    <Button
                      variant="ghost"
                      onClick={() => setDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleConnect}
                      disabled={!storeHandle.trim()}
                    >
                      Continue to Shopify
                      <IconArrowRight className="ml-1.5 h-4 w-4" />
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
