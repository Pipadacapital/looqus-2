'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  IconPlugConnected,
  IconCheck,
  IconExternalLink,
  IconRefresh,
  IconLoader2,
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
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const canConnect =
    storeHandle.trim() && clientId.trim() && clientSecret.trim()

  const handleConnect = async () => {
    if (!canConnect) return

    const cleaned = storeHandle
      .trim()
      .toLowerCase()
      .replace(/\.myshopify\.com$/, '')
      .replace(/^https?:\/\//, '')
      .split('/')[0]

    setConnecting(true)
    setError(null)

    try {
      const res = await fetch('/api/shopify/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: cleaned,
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          workspaceSlug,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to connect store')
        return
      }

      // Redirect to Shopify OAuth authorization page
      window.location.href = data.authUrl
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setConnecting(false)
    }
  }

  const handleSync = async () => {
    if (!shopifyConnection || syncing) return
    setSyncing(true)
    try {
      const res = await fetch('/api/shopify/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: shopifyConnection.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Sync failed')
        return
      }
      toast.success(
        `Synced ${data.orders} orders, ${data.products} products, ${data.customers} customers`
      )
      router.refresh()
    } catch {
      toast.error('Sync failed. Please try again.')
    } finally {
      setSyncing(false)
    }
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  {syncing ? (
                    <>
                      <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
                      Sync now
                    </>
                  )}
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
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Connect your Shopify store</DialogTitle>
                    <DialogDescription>
                      Enter your store handle and the app credentials from the{' '}
                      <a
                        href="https://dev.shopify.com/dashboard/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        Shopify Dev Dashboard
                      </a>
                      .
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4 py-2">
                    <div className="grid gap-2">
                      <Label htmlFor="store-handle">Store URL</Label>
                      <div className="flex items-center">
                        <Input
                          id="store-handle"
                          placeholder="your-store"
                          value={storeHandle}
                          onChange={(e) => setStoreHandle(e.target.value)}
                          className="rounded-r-none"
                          autoFocus
                        />
                        <span className="flex h-9 items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">
                          .myshopify.com
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="dash-client-id">Client ID</Label>
                      <Input
                        id="dash-client-id"
                        placeholder="Paste your app's Client ID"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="dash-client-secret">Client Secret</Label>
                      <Input
                        id="dash-client-secret"
                        type="password"
                        placeholder="Paste your app's Client Secret"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                      />
                    </div>

                    <div className="rounded-lg border bg-muted/50 p-3">
                      <p className="text-xs font-medium mb-1.5">How to get credentials</p>
                      <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal list-inside">
                        <li>Create an app in the <a href="https://dev.shopify.com/dashboard/" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Dev Dashboard</a></li>
                        <li>Configure access scopes (read_orders, read_products, etc.)</li>
                        <li>Install the app on your store</li>
                        <li>Copy Client ID &amp; Secret from Settings</li>
                      </ol>
                    </div>

                    {error && (
                      <p className="text-sm text-destructive">{error}</p>
                    )}
                  </div>

                  <DialogFooter>
                    <Button
                      variant="ghost"
                      onClick={() => setDialogOpen(false)}
                      disabled={connecting}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleConnect}
                      disabled={!canConnect || connecting}
                    >
                      {connecting ? (
                        <>
                          <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          Redirecting to Shopify...
                        </>
                      ) : (
                        <>
                          <IconPlugConnected className="mr-1.5 h-4 w-4" />
                          Continue to Shopify
                        </>
                      )}
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
