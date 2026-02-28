'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  IconPlugConnected,
  IconCheck,
  IconExternalLink,
  IconRefresh,
  IconLoader2,
  IconBrandMeta,
  IconBrandGoogle,
  IconUnlink,
  IconTruck,
  IconBrain,
  IconSend,
  IconChartLine,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatDistanceToNow, format, subDays } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'

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

function TrendPill({ value }: { value: number }) {
  const s = value >= 0 ? `+${value}%` : `${value}%`
  const positive = value > 0
  const negative = value < 0
  return (
    <span
      className={
        positive
          ? 'text-emerald-600 dark:text-emerald-400 font-medium'
          : negative
            ? 'text-red-600 dark:text-red-400 font-medium'
            : 'text-muted-foreground'
      }
    >
      {s}
    </span>
  )
}

interface DashboardContentProps {
  workspaceSlug: string
  workspaceId: string
  workspaceName: string
  isSuperadmin?: boolean
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
  shopifyConnection,
  metaConnection,
  googleConnection,
  shiprocketConnection,
}: DashboardContentProps) {
  const [storeHandle, setStoreHandle] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [syncing, setSyncing] = useState<string | null>(null)
  const [shopifySyncing, setShopifySyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [selectingAccount, setSelectingAccount] = useState(false)
  const [refreshingAccounts, setRefreshingAccounts] = useState(false)

  // Shiprocket connect form state
  const [srDialogOpen, setSrDialogOpen] = useState(false)
  const [srEmail, setSrEmail] = useState('')
  const [srPassword, setSrPassword] = useState('')
  const [srConnecting, setSrConnecting] = useState(false)
  const [srError, setSrError] = useState<string | null>(null)

  // Google Ads performance (Triple Whale–style)
  type GoogleAdsSummary = {
    impressions: number
    clicks: number
    spend: number
    conversions: number
    conversionValue: number
    roas: number
    from: string
    to: string
    days: number
  }
  type GoogleAdsCampaignRow = {
    campaignId: string
    campaignName: string
    impressions: number
    clicks: number
    spend: number
    conversions: number
    conversionValue: number
    roas: number
  }
  const [googleAdsMetrics, setGoogleAdsMetrics] = useState<{
    summary: GoogleAdsSummary | null
    byCampaign: GoogleAdsCampaignRow[]
    loading: boolean
    error: string | null
  }>({ summary: null, byCampaign: [], loading: false, error: null })

  // Analytics Insights (AI insights, trend, anomalies, recommendations)
  type AiInsight = {
    insight_type: string
    title: string
    reason: string
    recommendation: string
    confidence: number
  }
  type TrendMeta = { spendPctChange: number; revenuePctChange: number; roasPctChange: number }
  type TrendGoogle = { spendPctChange: number; conversionValuePctChange: number; roasPctChange: number }
  type Anomaly = { type: string; source: string; description: string; date?: string; campaign?: string; value?: number; priorValue?: number }
  type Recommendation = { title: string; text: string }
  const [aiInsights, setAiInsights] = useState<{
    insights: AiInsight[]
    trend: { meta?: TrendMeta; google?: TrendGoogle } | null
    anomalies: Anomaly[]
    recommendations: Recommendation[]
    modelUsed: string | null
    loading: boolean
    error: string | null
  }>({ insights: [], trend: null, anomalies: [], recommendations: [], modelUsed: null, loading: false, error: null })
  const canFetchInsights = !!(metaConnection || googleConnection)

  // Shopify Analytics (daily net sales, orders, AOV) with date range
  type ShopifyAnalyticsDailyRow = { date: string; netSales: number; grossSales: number; totalTax: number; totalDiscount: number; ordersCount: number; aov: number; currency: string; cogs: number; shipping: number; packaging: number; websiteCharges: number; cm1: number }
  type ShopifyAnalyticsSummary = { totalNetSales: number; totalGrossSales: number; totalTax: number; totalDiscount: number; totalOrders: number; avgAov: number; totalCogs: number; totalShipping: number; totalPackaging: number; totalWebsiteCharges: number; cm1: number; cm2?: number; miscExpensesTotal?: number; cm3?: number; currency: string; from: string; to: string; rtoOrders?: number; rtoPercent?: number | null; rtoValue?: number; rtoMapped?: number; rtoUnmapped?: number; totalShipmentsInRange?: number }
  const [analyticsFrom, setAnalyticsFrom] = useState<string>(() => format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [analyticsTo, setAnalyticsTo] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'))
  const [shopifyAnalytics, setShopifyAnalytics] = useState<{
    daily: ShopifyAnalyticsDailyRow[]
    summary: ShopifyAnalyticsSummary | null
    loading: boolean
    error: string | null
  }>({ daily: [], summary: null, loading: false, error: null })

  // AI chat (same context as insights) — streaming + Markdown
  type ChatMessage = { role: 'user' | 'assistant'; content: string }
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const msg = chatInput.trim()
    if (!msg || chatLoading || !workspaceSlug) return
    setChatInput('')
    setChatMessages((prev) => [...prev, { role: 'user', content: msg }])
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }])
    setStreamingContent('')
    setChatLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/insights/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, stream: true }),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Request failed')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const data = JSON.parse(line) as { delta?: string; done?: boolean; error?: string }
            if (data.error) {
              fullContent = `Error: ${data.error}`
              break
            }
            if (typeof data.delta === 'string') {
              fullContent += data.delta
              setStreamingContent(fullContent)
            }
          } catch {
            // skip malformed line
          }
        }
      }
      setChatMessages((prev) => {
        const next = [...prev]
        if (next.length > 0 && next[next.length - 1].role === 'assistant') {
          next[next.length - 1] = { role: 'assistant', content: fullContent || next[next.length - 1].content }
        }
        return next
      })
      setStreamingContent('')
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to send. Check Ollama is running.'
      setChatMessages((prev) => {
        const next = [...prev]
        if (next.length > 0 && next[next.length - 1].role === 'assistant' && next[next.length - 1].content === '') {
          next[next.length - 1] = { role: 'assistant', content: errMsg }
        } else {
          next.push({ role: 'assistant', content: errMsg })
        }
        return next
      })
      setStreamingContent('')
    } finally {
      setChatLoading(false)
    }
  }

  const canFetchGoogleAds =
    googleConnection &&
    (googleConnection.customerIds.length === 0 ||
      (googleConnection.customerIds.length > 1 && googleConnection.selectedCustomerId) ||
      googleConnection.customerIds.length === 1)

  useEffect(() => {
    if (!canFetchGoogleAds || !workspaceSlug) return
    setGoogleAdsMetrics((prev) => ({ ...prev, loading: true, error: null }))
    fetch(`/api/workspaces/${workspaceSlug}/google-ads/metrics?days=30`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error && !data.summary) {
          setGoogleAdsMetrics({
            summary: null,
            byCampaign: [],
            loading: false,
            error: data.error,
          })
          return
        }
        setGoogleAdsMetrics({
          summary: data.summary ?? null,
          byCampaign: data.byCampaign ?? [],
          loading: false,
          error: null,
        })
      })
      .catch(() => {
        setGoogleAdsMetrics((prev) => ({
          ...prev,
          loading: false,
          error: 'Failed to load Google Ads metrics',
        }))
      })
  }, [workspaceSlug, canFetchGoogleAds, googleConnection?.id, googleConnection?.selectedCustomerId])

  useEffect(() => {
    if (!shopifyConnection?.id || !workspaceSlug || !analyticsFrom || !analyticsTo) return
    setShopifyAnalytics((prev) => ({ ...prev, loading: true, error: null }))
    fetch(`/api/workspaces/${workspaceSlug}/shopify-analytics?from=${analyticsFrom}&to=${analyticsTo}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setShopifyAnalytics({ daily: [], summary: null, loading: false, error: data.error })
          return
        }
        setShopifyAnalytics({
          daily: data.daily ?? [],
          summary: data.summary ?? null,
          loading: false,
          error: null,
        })
      })
      .catch(() => {
        setShopifyAnalytics((prev) => ({ ...prev, loading: false, error: 'Failed to load analytics' }))
      })
  }, [workspaceSlug, shopifyConnection?.id, analyticsFrom, analyticsTo])

  useEffect(() => {
    if (!canFetchInsights || !workspaceSlug) return
    setAiInsights((prev) => ({ ...prev, loading: true, error: null }))
    fetch(`/api/workspaces/${workspaceSlug}/insights?days=30`)
      .then((res) => res.json())
      .then((data) => {
        setAiInsights({
          insights: data.insights ?? [],
          trend: data.trend ?? null,
          anomalies: data.anomalies ?? [],
          recommendations: data.recommendations ?? [],
          modelUsed: data.modelUsed ?? null,
          loading: false,
          error: data.error ?? null,
        })
      })
      .catch(() => {
        setAiInsights((prev) => ({
          ...prev,
          loading: false,
          error: 'Failed to load AI insights',
        }))
      })
  }, [workspaceSlug, canFetchInsights])

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

      window.location.href = data.authUrl
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async (provider: 'meta' | 'google') => {
    setDisconnecting(provider)
    try {
      await fetch(`/api/integrations/${provider}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      window.location.reload()
    } finally {
      setDisconnecting(null)
    }
  }

  const handleSync = async (provider: 'meta' | 'google') => {
    setSyncing(provider)
    try {
      const res = await fetch(`/api/integrations/${provider}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || `Sync failed (${res.status})`)
        return
      }
      toast.success('Sync started')
      window.location.reload()
    } finally {
      setSyncing(null)
    }
  }

  const handleShopifySync = async () => {
    if (!shopifyConnection?.id) return
    setShopifySyncing(true)
    try {
      const res = await fetch('/api/shopify/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: shopifyConnection.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Shopify sync failed')
        return
      }
      toast.success('Shopify sync started')
      window.location.reload()
    } finally {
      setShopifySyncing(false)
    }
  }

  const getEffectiveMetaSelection = (): string[] => {
    if (metaConnection?.selectedAdAccountIds?.length) return metaConnection.selectedAdAccountIds
    if (metaConnection?.selectedAdAccountId) return [metaConnection.selectedAdAccountId]
    return []
  }

  const getEffectiveGoogleSelection = (): string[] => {
    if (googleConnection?.selectedCustomerIds?.length) return googleConnection.selectedCustomerIds
    if (googleConnection?.selectedCustomerId) return [googleConnection.selectedCustomerId]
    return []
  }

  const handleToggleMetaAccount = async (accountId: string, checked: boolean) => {
    if (!metaConnection) return
    const current = getEffectiveMetaSelection()
    const next = checked
      ? [...current, accountId]
      : current.filter((id) => id !== accountId)
    if (next.length === 0) {
      toast.error('At least one ad account must be selected')
      return
    }
    setSelectingAccount(true)
    try {
      const res = await fetch('/api/integrations/meta/select-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, selectedAdAccountIds: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to update selection')
        return
      }
      window.location.reload()
    } finally {
      setSelectingAccount(false)
    }
  }

  const handleToggleGoogleCustomer = async (customerId: string, checked: boolean) => {
    if (!googleConnection) return
    const current = getEffectiveGoogleSelection()
    const next = checked
      ? [...current, customerId]
      : current.filter((id) => id !== customerId)
    if (next.length === 0) {
      toast.error('At least one customer must be selected')
      return
    }
    setSelectingAccount(true)
    try {
      const res = await fetch('/api/integrations/google/select-customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, selectedCustomerIds: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to update selection')
        return
      }
      window.location.reload()
    } finally {
      setSelectingAccount(false)
    }
  }

  const handleRefreshGoogleAccounts = async () => {
    setRefreshingAccounts(true)
    try {
      await fetch('/api/integrations/google/refresh-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      window.location.reload()
    } finally {
      setRefreshingAccounts(false)
    }
  }

  const handleShiprocketConnect = async () => {
    if (!srEmail.trim() || !srPassword.trim()) return
    setSrConnecting(true)
    setSrError(null)
    try {
      const res = await fetch('/api/integrations/shiprocket/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, email: srEmail.trim(), password: srPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSrError(data.error || 'Failed to connect Shiprocket')
        return
      }
      setSrDialogOpen(false)
      window.location.reload()
    } catch {
      setSrError('Network error. Please try again.')
    } finally {
      setSrConnecting(false)
    }
  }

  const handleShiprocketDisconnect = async () => {
    setDisconnecting('shiprocket')
    try {
      await fetch('/api/integrations/shiprocket/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      window.location.reload()
    } finally {
      setDisconnecting(null)
    }
  }

  const handleShiprocketSync = async () => {
    setSyncing('shiprocket')
    try {
      await fetch('/api/integrations/shiprocket/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      window.location.reload()
    } finally {
      setSyncing(null)
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
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
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
                <p className="text-sm font-medium">{shopifyConnection.shopDomain}</p>
                <p className="text-xs text-muted-foreground">
                  Connected{' '}
                  {formatDistanceToNow(new Date(shopifyConnection.installedAt), { addSuffix: true })}
                  {shopifyConnection.lastSyncAt && (
                    <>
                      {' · '}Last synced{' '}
                      {formatDistanceToNow(new Date(shopifyConnection.lastSyncAt), { addSuffix: true })}
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShopifySync}
                  disabled={shopifySyncing}
                >
                  {shopifySyncing ? (
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
                  <a href={`https://${shopifyConnection.shopDomain}/admin`} target="_blank" rel="noopener noreferrer">
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
                  Connect your Shopify store to pull in orders, products, and customer data for analytics.
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
                      <a href="https://dev.shopify.com/dashboard/" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                        Shopify Dev Dashboard
                      </a>.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <div className="grid gap-2">
                      <Label htmlFor="store-handle">Store URL</Label>
                      <div className="flex items-center">
                        <Input id="store-handle" placeholder="your-store" value={storeHandle} onChange={(e) => setStoreHandle(e.target.value)} className="rounded-r-none" autoFocus />
                        <span className="flex h-9 items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">.myshopify.com</span>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="dash-client-id">Client ID</Label>
                      <Input id="dash-client-id" placeholder="Paste your app's Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="dash-client-secret">Client Secret</Label>
                      <Input id="dash-client-secret" type="password" placeholder="Paste your app's Client Secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
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
                    {error && <p className="text-sm text-destructive">{error}</p>}
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={connecting}>Cancel</Button>
                    <Button onClick={handleConnect} disabled={!canConnect || connecting}>
                      {connecting ? (
                        <><IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" />Redirecting to Shopify...</>
                      ) : (
                        <><IconPlugConnected className="mr-1.5 h-4 w-4" />Continue to Shopify</>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      </div>

      {/* Shopify Analytics — net sales, orders, AOV with date range & graph */}
      {shopifyConnection && (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#96bf48]/10">
              <IconChartLine className="h-5 w-5 text-[#96bf48]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Shopify Analytics</p>
              <p className="text-xs text-muted-foreground">
                Net sales, orders, and AOV by day. Use date filters or presets below.
              </p>
            </div>
          </div>
          <div className="px-6 py-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="analytics-from" className="text-xs whitespace-nowrap">From</Label>
                <Input
                  id="analytics-from"
                  type="date"
                  value={analyticsFrom}
                  onChange={(e) => setAnalyticsFrom(e.target.value)}
                  className="w-[140px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="analytics-to" className="text-xs whitespace-nowrap">To</Label>
                <Input
                  id="analytics-to"
                  type="date"
                  value={analyticsTo}
                  onChange={(e) => setAnalyticsTo(e.target.value)}
                  className="w-[140px]"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: '7D', days: 7 },
                  { label: '30D', days: 30 },
                  { label: '90D', days: 90 },
                ].map(({ label, days }) => (
                  <Button
                    key={label}
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      const to = new Date()
                      const from = subDays(to, days - 1)
                      setAnalyticsFrom(format(from, 'yyyy-MM-dd'))
                      setAnalyticsTo(format(to, 'yyyy-MM-dd'))
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {shopifyAnalytics.loading ? (
              <div className="flex items-center justify-center py-12">
                <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : shopifyAnalytics.error ? (
              <p className="text-sm text-muted-foreground py-4">{shopifyAnalytics.error}</p>
            ) : shopifyAnalytics.summary ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Gross Sales</p>
                    <p className="text-xl font-semibold mt-0.5">
                      {shopifyAnalytics.summary.currency === 'INR' ? '₹' : '$'}
                      {shopifyAnalytics.summary.totalGrossSales.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Net sales</p>
                    <p className="text-xl font-semibold mt-0.5">
                      {shopifyAnalytics.summary.currency === 'INR' ? '₹' : '$'}
                      {shopifyAnalytics.summary.totalNetSales.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Discounts</p>
                    <p className="text-xl font-semibold mt-0.5">
                      {shopifyAnalytics.summary.currency === 'INR' ? '₹' : '$'}
                      {shopifyAnalytics.summary.totalDiscount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Tax</p>
                    <p className="text-xl font-semibold mt-0.5">
                      {shopifyAnalytics.summary.currency === 'INR' ? '₹' : '$'}
                      {shopifyAnalytics.summary.totalTax.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Orders</p>
                    <p className="text-xl font-semibold mt-0.5">
                      {shopifyAnalytics.summary.totalOrders.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">COGS</p>
                    <p className="text-xl font-semibold mt-0.5">
                      {shopifyAnalytics.summary.currency === 'INR' ? '₹' : '$'}
                      {shopifyAnalytics.summary.totalCogs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Other Costs</p>
                    <p className="text-xl font-semibold mt-0.5">
                      {shopifyAnalytics.summary.currency === 'INR' ? '₹' : '$'}
                      {(shopifyAnalytics.summary.totalShipping + shopifyAnalytics.summary.totalPackaging + shopifyAnalytics.summary.totalWebsiteCharges).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-[#96bf48]/10 p-4">
                    <p className="text-xs font-bold text-[#96bf48] uppercase tracking-wider">CM1</p>
                    <p className="text-xl font-bold mt-0.5 text-[#96bf48]">
                      {shopifyAnalytics.summary.currency === 'INR' ? '₹' : '$'}
                      {shopifyAnalytics.summary.cm1.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  {shopifyAnalytics.summary.cm3 != null && (
                    <div className="rounded-lg border bg-[#96bf48]/10 p-4">
                      <p className="text-xs font-bold text-[#96bf48] uppercase tracking-wider">CM3</p>
                      <p className="text-xl font-bold mt-0.5 text-[#96bf48]">
                        {shopifyAnalytics.summary.currency === 'INR' ? '₹' : '$'}
                        {shopifyAnalytics.summary.cm3.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  )}
                </div>

                {shopifyAnalytics.daily.length > 0 ? (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Net sales over time</p>
                    <ChartContainer
                      config={{
                        netSales: { label: 'Net sales', color: '#96bf48' },
                        ordersCount: { label: 'Orders', color: 'hsl(var(--chart-2))' },
                      } satisfies ChartConfig}
                      className="h-[280px] w-full"
                    >
                      <AreaChart
                        data={shopifyAnalytics.daily.map((d) => ({
                          ...d,
                          dateLabel: format(new Date(d.date), 'MMM d'),
                        }))}
                        margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="dateLabel"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          tickFormatter={(v) => `${shopifyAnalytics.summary?.currency === 'INR' ? '₹' : '$'}${(v / 1000).toFixed(0)}k`}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(v) => [
                                `${shopifyAnalytics.summary?.currency === 'INR' ? '₹' : '$'}${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
                                'Net sales',
                              ]}
                              labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? format(new Date(payload[0].payload.date), 'MMM d, yyyy') : ''}
                            />
                          }
                        />
                        <Area
                          type="monotone"
                          dataKey="netSales"
                          stroke="var(--color-netSales)"
                          fill="var(--color-netSales)"
                          fillOpacity={0.3}
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ChartContainer>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No daily data for this range. Sync Shopify from the card above or run &quot;Refresh analytics&quot; in Admin.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-4">
                No analytics data yet. Sync your Shopify store above, then refresh analytics from Admin if needed.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Meta Ads Connection Card */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1877F2]/10">
            <IconBrandMeta className="h-5 w-5 text-[#1877F2]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Meta Ads</p>
            <p className="text-xs text-muted-foreground">
              {metaConnection
                ? `${metaConnection.adAccountIds.length} ad account(s) connected`
                : 'Connect your Meta Ads account for marketing insights'}
            </p>
          </div>
          {metaConnection ? (
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
              <IconCheck className="mr-1 h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
        </div>

        <div className="px-6 py-4">
          {metaConnection ? (
            <div className="space-y-3">
              {metaConnection.adAccountIds.length >= 1 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Ad accounts ({getEffectiveMetaSelection().length}/{metaConnection.adAccountIds.length} selected)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {metaConnection.adAccountIds.map((id) => {
                      const selected = getEffectiveMetaSelection().includes(id)
                      return (
                        <label
                          key={id}
                          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs cursor-pointer transition-colors ${
                            selected
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-border text-muted-foreground hover:border-primary/40'
                          }`}
                        >
                          <Checkbox
                            checked={selected}
                            disabled={selectingAccount}
                            onCheckedChange={(checked) =>
                              handleToggleMetaAccount(id, !!checked)
                            }
                            className="h-3.5 w-3.5"
                          />
                          {id}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Connected{' '}
                    {formatDistanceToNow(new Date(metaConnection.createdAt), { addSuffix: true })}
                    {metaConnection.lastSyncAt && (
                      <>{' · '}Last synced {formatDistanceToNow(new Date(metaConnection.lastSyncAt), { addSuffix: true })}</>
                    )}
                  </p>
                  {metaConnection.lastSyncError && (
                    <p className="text-xs text-destructive">{metaConnection.lastSyncError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSync('meta')}
                    disabled={syncing === 'meta' || (metaConnection.adAccountIds.length > 1 && getEffectiveMetaSelection().length === 0)}
                  >
                    {syncing === 'meta' ? (
                      <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Sync now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisconnect('meta')}
                    disabled={disconnecting === 'meta'}
                  >
                    <IconUnlink className="mr-1.5 h-3.5 w-3.5" />
                    Disconnect
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="max-w-sm space-y-1">
                <p className="text-sm font-medium">No Meta Ads account connected</p>
                <p className="text-xs text-muted-foreground">
                  Connect your Meta (Facebook) Ads account to pull in campaign performance data.
                </p>
              </div>
              <Button asChild>
                <a href={`/api/integrations/meta/start?workspaceId=${workspaceId}`}>
                  <IconBrandMeta className="mr-1.5 h-4 w-4" />
                  Connect Meta Ads
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Google Ads Connection Card */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4285F4]/10">
            <IconBrandGoogle className="h-5 w-5 text-[#4285F4]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Google Ads</p>
            <p className="text-xs text-muted-foreground">
              {googleConnection
                ? `${googleConnection.customerIds.length} customer ID(s) connected`
                : 'Connect your Google Ads account for search & display insights'}
            </p>
          </div>
          {googleConnection ? (
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
              <IconCheck className="mr-1 h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
        </div>

        <div className="px-6 py-4">
          {googleConnection ? (
            <div className="space-y-3">
              {googleConnection.customerIds.length >= 1 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Customer IDs ({getEffectiveGoogleSelection().length}/{googleConnection.customerIds.length} selected)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {googleConnection.customerIds.map((id) => {
                      const selected = getEffectiveGoogleSelection().includes(id)
                      return (
                        <label
                          key={id}
                          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs cursor-pointer transition-colors ${
                            selected
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-border text-muted-foreground hover:border-primary/40'
                          }`}
                        >
                          <Checkbox
                            checked={selected}
                            disabled={selectingAccount}
                            onCheckedChange={(checked) =>
                              handleToggleGoogleCustomer(id, !!checked)
                            }
                            className="h-3.5 w-3.5"
                          />
                          {id}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
              {googleConnection.customerIds.length === 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950">
                  <p className="flex-1 text-xs text-amber-800 dark:text-amber-200">
                    No Google Ads customers found. Check developer token and account permissions.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshGoogleAccounts}
                    disabled={refreshingAccounts}
                    className="shrink-0"
                  >
                    {refreshingAccounts ? (
                      <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Refresh accounts
                  </Button>
                </div>
              )}
              {googleConnection.googleEmail && (
                <p className="text-xs text-muted-foreground">{googleConnection.googleEmail}</p>
              )}
              {/* Google Ads performance (Triple Whale–style) */}
              {canFetchGoogleAds && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Performance (last 30 days)
                  </p>
                  {googleAdsMetrics.loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <IconLoader2 className="h-4 w-4 animate-spin" />
                      Loading metrics…
                    </div>
                  ) : googleAdsMetrics.error ? (
                    <p className="text-sm text-muted-foreground">{googleAdsMetrics.error}</p>
                  ) : googleAdsMetrics.summary ? (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Spend</p>
                          <p className="text-sm font-semibold">
                            ₹{googleAdsMetrics.summary.spend.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Conversions</p>
                          <p className="text-sm font-semibold">
                            {googleAdsMetrics.summary.conversions.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Conversion value</p>
                          <p className="text-sm font-semibold">
                            ₹{googleAdsMetrics.summary.conversionValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">ROAS</p>
                          <p className="text-sm font-semibold">
                            {googleAdsMetrics.summary.roas.toFixed(2)}x
                          </p>
                        </div>
                      </div>
                      {googleAdsMetrics.byCampaign.length > 0 && (
                        <div className="border-t pt-3">
                          <p className="text-xs font-medium text-muted-foreground mb-2">Top campaigns by spend</p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                  <th className="py-1.5 font-medium">Campaign</th>
                                  <th className="py-1.5 font-medium text-right">Spend</th>
                                  <th className="py-1.5 font-medium text-right">Conv. value</th>
                                  <th className="py-1.5 font-medium text-right">ROAS</th>
                                </tr>
                              </thead>
                              <tbody>
                                {googleAdsMetrics.byCampaign.slice(0, 5).map((c) => (
                                  <tr key={c.campaignId} className="border-b border-border/50">
                                    <td className="py-1.5 truncate max-w-[140px]" title={c.campaignName}>
                                      {c.campaignName || c.campaignId}
                                    </td>
                                    <td className="py-1.5 text-right">₹{c.spend.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                                    <td className="py-1.5 text-right">₹{c.conversionValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                                    <td className="py-1.5 text-right">{c.roas.toFixed(2)}x</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Connected{' '}
                    {formatDistanceToNow(new Date(googleConnection.createdAt), { addSuffix: true })}
                    {googleConnection.lastSyncAt && (
                      <>{' · '}Last synced {formatDistanceToNow(new Date(googleConnection.lastSyncAt), { addSuffix: true })}</>
                    )}
                  </p>
                  {googleConnection.lastSyncError && (
                    <p className="text-xs text-destructive">{googleConnection.lastSyncError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSync('google')}
                    disabled={syncing === 'google' || googleConnection.customerIds.length === 0 || (googleConnection.customerIds.length > 1 && getEffectiveGoogleSelection().length === 0)}
                  >
                    {syncing === 'google' ? (
                      <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Sync now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisconnect('google')}
                    disabled={disconnecting === 'google'}
                  >
                    <IconUnlink className="mr-1.5 h-3.5 w-3.5" />
                    Disconnect
                  </Button>
                </div>
                {isSuperadmin && (
                  <p className="text-xs text-muted-foreground mt-2">
                    <Link href="/admin" className="text-primary underline underline-offset-2 hover:no-underline">
                      Superadmin
                    </Link>
                    {' '}— sync all Google Ads, manage all users & workspaces.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="max-w-sm space-y-1">
                <p className="text-sm font-medium">No Google Ads account connected</p>
                <p className="text-xs text-muted-foreground">
                  Connect your Google Ads account to pull in campaign performance data.
                </p>
              </div>
              <Button asChild>
                <a href={`/api/integrations/google/start?workspaceId=${workspaceId}`}>
                  <IconBrandGoogle className="mr-1.5 h-4 w-4" />
                  Connect Google Ads
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Analytics Insights — latest insights, trend, anomalies, recommendations */}
      {canFetchInsights && (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10">
              <IconBrain className="h-5 w-5 text-violet-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Analytics Insights</p>
              <p className="text-xs text-muted-foreground">
                AI intelligence: latest insights, trend, anomalies, recommendations (Ollama)
              </p>
            </div>
          </div>
          <div className="px-6 py-4 space-y-6">
            {aiInsights.loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <IconLoader2 className="h-4 w-4 animate-spin" />
                Generating insights…
              </div>
            ) : aiInsights.error ? (
              <p className="text-sm text-muted-foreground py-2">{aiInsights.error}</p>
            ) : (
              <>
                {/* Trend analysis */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Trend analysis (vs prior period)
                  </p>
                  {aiInsights.trend && (aiInsights.trend.meta || aiInsights.trend.google) ? (
                    <div className="rounded-lg border bg-muted/20 p-3 flex flex-wrap gap-4">
                      {aiInsights.trend.meta && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Meta Ads</p>
                          <p className="text-sm">
                            Spend <TrendPill value={aiInsights.trend.meta.spendPctChange} /> · Revenue <TrendPill value={aiInsights.trend.meta.revenuePctChange} /> · ROAS <TrendPill value={aiInsights.trend.meta.roasPctChange} />
                          </p>
                        </div>
                      )}
                      {aiInsights.trend.google && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Google Ads</p>
                          <p className="text-sm">
                            Spend <TrendPill value={aiInsights.trend.google.spendPctChange} /> · Conv. value <TrendPill value={aiInsights.trend.google.conversionValuePctChange} /> · ROAS <TrendPill value={aiInsights.trend.google.roasPctChange} />
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No trend data (need current + prior period metrics).</p>
                  )}
                </div>

                {/* Anomalies */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Anomalies
                  </p>
                  {aiInsights.anomalies.length > 0 ? (
                    <ul className="space-y-2">
                      {aiInsights.anomalies.map((a, i) => (
                        <li key={i} className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/30 px-3 py-2 text-sm">
                          <span className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase">{a.type.replace(/_/g, ' ')}</span>
                          <span className="text-muted-foreground ml-1">({a.source})</span>
                          <p className="mt-0.5">{a.description}</p>
                          {(a.date || a.campaign) && (
                            <p className="text-xs text-muted-foreground">{[a.date, a.campaign].filter(Boolean).join(' · ')}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No anomalies detected.</p>
                  )}
                </div>

                {/* Recommendations */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Recommendations
                  </p>
                  {aiInsights.recommendations.length > 0 ? (
                    <ul className="space-y-2">
                      {aiInsights.recommendations.map((r, i) => (
                        <li key={i} className="rounded-lg border bg-muted/20 p-3">
                          {r.title && <p className="text-sm font-medium mb-0.5">{r.title}</p>}
                          <p className="text-sm text-muted-foreground">{r.text}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No recommendations yet. Generate insights above.</p>
                  )}
                </div>

                {/* Latest AI insights */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Latest AI insights
                  </p>
                  {aiInsights.insights.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No insights yet. Ensure Ollama is running (e.g. <code className="text-xs bg-muted px-1 rounded">ollama run llama3.2</code>). You can still use trend, anomalies, and chat below.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {aiInsights.modelUsed && (
                        <p className="text-xs text-muted-foreground">Model: {aiInsights.modelUsed}</p>
                      )}
                      <ul className="space-y-3">
                        {aiInsights.insights.map((insight, i) => (
                          <li key={i} className="rounded-lg border bg-muted/30 p-3 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                {insight.insight_type.replace(/_/g, ' ')}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {(insight.confidence * 100).toFixed(0)}% confidence
                              </span>
                            </div>
                            {insight.title && (
                              <p className="text-sm font-medium">{insight.title}</p>
                            )}
                            <p className="text-sm text-muted-foreground">{insight.reason}</p>
                            <p className="text-sm">
                              <span className="text-muted-foreground">Recommendation: </span>
                              {insight.recommendation}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* AI Chat — ask about metrics & insights (always shown when AI Insights card is visible) */}
            <div className="border-t pt-4 mt-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Ask about your data
              </p>
              <div className="rounded-lg border bg-muted/20 min-h-[120px] max-h-[280px] overflow-y-auto flex flex-col">
                {chatMessages.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">
                    e.g. &quot;Why is my ROAS low?&quot;, &quot;Which campaign should I focus on?&quot;, &quot;Summarize my ad performance&quot;
                  </p>
                ) : (
                  <div className="p-3 space-y-3">
                    {chatMessages.map((m, i) => {
                      const isLastAssistant = i === chatMessages.length - 1 && m.role === 'assistant'
                      const text = isLastAssistant && streamingContent ? m.content + streamingContent : m.content
                      const showCursor = isLastAssistant && chatLoading
                      return (
                        <div
                          key={i}
                          className={
                            m.role === 'user'
                              ? 'ml-4 text-sm bg-violet-500/10 text-violet-800 dark:text-violet-200 rounded-lg px-3 py-2'
                              : 'mr-4 text-sm bg-muted rounded-lg px-3 py-2 prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0'
                          }
                        >
                          {m.role === 'user' ? (
                            m.content
                          ) : (
                            <>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || '…'}</ReactMarkdown>
                              {showCursor && <span className="inline-block w-2 h-4 ml-0.5 bg-violet-500 animate-pulse" aria-hidden />}
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <form onSubmit={handleChatSubmit} className="flex gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask about ROAS, campaigns, spend..."
                  className="flex-1"
                  disabled={chatLoading}
                />
                <Button type="submit" size="icon" disabled={chatLoading || !chatInput.trim()}>
                  {chatLoading ? (
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <IconSend className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Shiprocket Connection Card */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#6E3FF3]/10">
            <IconTruck className="h-5 w-5 text-[#6E3FF3]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Shiprocket</p>
            <p className="text-xs text-muted-foreground">
              {shiprocketConnection
                ? `Connected as ${shiprocketConnection.email}`
                : 'Connect your Shiprocket account for shipping insights'}
            </p>
          </div>
          {shiprocketConnection ? (
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
              <IconCheck className="mr-1 h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
        </div>

        <div className="px-6 py-4">
          {shiprocketConnection ? (
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">{shiprocketConnection.email}</p>
                <p className="text-xs text-muted-foreground">
                  Connected{' '}
                  {formatDistanceToNow(new Date(shiprocketConnection.createdAt), { addSuffix: true })}
                  {shiprocketConnection.lastSyncAt && (
                    <>{' · '}Last synced {formatDistanceToNow(new Date(shiprocketConnection.lastSyncAt), { addSuffix: true })}</>
                  )}
                </p>
                {shiprocketConnection.lastSyncError && (
                  <p className="text-xs text-destructive">{shiprocketConnection.lastSyncError}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShiprocketSync}
                  disabled={syncing === 'shiprocket'}
                >
                  {syncing === 'shiprocket' ? (
                    <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Sync now
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShiprocketDisconnect}
                  disabled={disconnecting === 'shiprocket'}
                >
                  <IconUnlink className="mr-1.5 h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="max-w-sm space-y-1">
                <p className="text-sm font-medium">No Shiprocket account connected</p>
                <p className="text-xs text-muted-foreground">
                  Connect your Shiprocket account to pull in shipment, order, and delivery data.
                </p>
              </div>
              <Dialog open={srDialogOpen} onOpenChange={setSrDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <IconTruck className="mr-1.5 h-4 w-4" />
                    Connect Shiprocket
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Connect Shiprocket</DialogTitle>
                    <DialogDescription>
                      Enter the email and password for your Shiprocket account.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <div className="grid gap-2">
                      <Label htmlFor="sr-email">Email</Label>
                      <Input
                        id="sr-email"
                        type="email"
                        placeholder="you@example.com"
                        value={srEmail}
                        onChange={(e) => setSrEmail(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="sr-password">Password</Label>
                      <Input
                        id="sr-password"
                        type="password"
                        placeholder="Your Shiprocket password"
                        value={srPassword}
                        onChange={(e) => setSrPassword(e.target.value)}
                      />
                    </div>
                    {srError && <p className="text-sm text-destructive">{srError}</p>}
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setSrDialogOpen(false)} disabled={srConnecting}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleShiprocketConnect}
                      disabled={!srEmail.trim() || !srPassword.trim() || srConnecting}
                    >
                      {srConnecting ? (
                        <><IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" />Connecting...</>
                      ) : (
                        <><IconTruck className="mr-1.5 h-4 w-4" />Connect</>
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
