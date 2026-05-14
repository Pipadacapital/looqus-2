'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────
interface AiInsight {
  insight_type: string
  title: string
  reason: string
  recommendation: string
  confidence: number
  severity?: 'high' | 'medium' | 'low'
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ContextSummary {
  pnl: { netSales: number; cm1: number; cm2: number; cm3: number; netProfit: number; adSpend: number; cogs: number; cm1Margin: number | null; cm2Margin: number | null; cm3Margin: number | null; netProfitMargin: number | null; ordersCount: number }
  analytics: { avgAov: number; totalOrders: number; totalSessions: number | null; conversionRate: number | null; prepaidPercentage: number | null }
  ads: { totalSpend: number; blendedRoas: number | null; acos: number | null; metaSpend: number; googleSpend: number }
  orders: { rtoOrders: number; rtoPercent: number | null; rtoValue: number; prepaidPercentage: number | null; shiprocketConnected: boolean }
  cohorts: { averageCac: number; avg90DayRepeat: number; averagePayback: number | null; newCustomers: number } | null
  timings: { median1to2: number; secondOrdersPct: number; reactivationDays: number } | null
  inventory: { totalProducts: number; deadStockCount: number; lowStockCount: number; healthyStockCount: number; avgDaysLeft: number | null } | null
  period: { from: string; to: string; days: number }
  currency: string
}

// ─── Component ─────────────────────────────────────────────
export default function AiInsightsV2({
  workspaceSlug,
  workspaceName,
}: {
  workspaceSlug: string
  workspaceName: string
}) {
  const [days, setDays] = useState(30)
  const [model, setModel] = useState('')
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [contextData, setContextData] = useState<ContextSummary | null>(null)
  const [insights, setInsights] = useState<AiInsight[]>([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'insights' | 'chat'>('insights')
  const [error, setError] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceSlug}/ai/models`)
      .then(r => r.json())
      .then(data => {
        setModels(data.models || [])
        if (data.models?.length > 0) setModel(data.models[0].id)
      })
      .catch(() => {})
  }, [workspaceSlug])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const loadContext = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/ai-2/context?days=${days}`)
      if (!res.ok) throw new Error('Failed to load context')
      const data = await res.json()
      setContextData({
        pnl: data.pnl?.summary ?? {},
        analytics: data.analytics?.summary ?? {},
        ads: data.ads?.summary ?? {},
        orders: data.orders?.summary ?? {},
        cohorts: data.cohorts?.summary ?? null,
        timings: data.timings?.summary ?? null,
        inventory: data.inventory?.summary ?? null,
        period: data.period,
        currency: data.analytics?.summary?.currency ?? 'INR',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug, days])

  useEffect(() => { loadContext() }, [loadContext])

  const generateInsights = async () => {
    if (!model) return
    setInsightsLoading(true)
    setInsights([])
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/ai-2/insights?days=${days}&model=${model}`)
      const data = await res.json()
      if (data.error) setError(data.error)
      setInsights(data.insights || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate insights')
    } finally {
      setInsightsLoading(false)
    }
  }

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return
    const userMsg: ChatMessage = { role: 'user', content: chatInput.trim() }
    const updatedMessages = [...chatMessages, userMsg]
    setChatMessages(updatedMessages)
    setChatInput('')
    setChatLoading(true)

    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/ai-2/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, model, days, stream: true }),
      })

      if (!res.ok) throw new Error('Chat request failed')

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      let assistantContent = ''
      setChatMessages(prev => [...prev, { role: 'assistant', content: '' }])

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const data = JSON.parse(line)
            if (data.content) {
              assistantContent += data.content
              setChatMessages(prev => {
                const copy = [...prev]
                copy[copy.length - 1] = { role: 'assistant', content: assistantContent }
                return copy
              })
            }
          } catch {}
        }
      }
    } catch (e) {
      setChatMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${e instanceof Error ? e.message : 'Something went wrong'}` },
      ])
    } finally {
      setChatLoading(false)
    }
  }

  const sym = contextData?.currency === 'INR' ? '₹' : '$'
  const fmt = (n: number | null | undefined, d = 0) =>
    n != null ? n.toLocaleString('en-IN', { maximumFractionDigits: d }) : '—'

  const severityVariant = (s?: string): 'destructive' | 'default' | 'secondary' | 'outline' => {
    switch (s) {
      case 'high': return 'destructive'
      case 'medium': return 'default'
      case 'low': return 'secondary'
      default: return 'outline'
    }
  }

  const insightTypeIcon = (t: string) => {
    const icons: Record<string, string> = {
      performance_alert: '⚡', roas_drop: '📉', margin_risk: '⚠️',
      ad_efficiency: '🎯', sales_trend: '📊', rto_alert: '🔄',
      prepaid_trend: '💳', conversion_insight: '🔍', revenue_opportunity: '💰',
      inventory_alert: '📦', cohort_insight: '👥', timing_insight: '⏰',
    }
    return icons[t] || '💡'
  }

  const dataSources = [
    { label: 'P&L', active: !!contextData?.pnl?.netSales },
    { label: 'Ads', active: (contextData?.ads?.totalSpend ?? 0) > 0 },
    { label: 'Cohorts', active: !!contextData?.cohorts },
    { label: 'Timings', active: !!contextData?.timings },
    { label: 'Inventory', active: !!contextData?.inventory },
    { label: 'RTO', active: !!(contextData?.orders?.shiprocketConnected) },
  ]

  const chatMarkdownComponents = {
    h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-semibold mt-4 mb-1 first:mt-0">{children}</h1>,
    h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-semibold mt-3 mb-1 first:mt-0 text-foreground/90">{children}</h2>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-medium mt-2 mb-0.5">{children}</h3>,
    p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-4 my-2 space-y-0.5">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-4 my-2 space-y-0.5">{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
    code: ({ children, className, ...props }: { children?: React.ReactNode; className?: string }) => (
      <code className={cn('rounded bg-foreground/10 px-1 py-0.5 text-xs font-mono', className)} {...props}>
        {children}
      </code>
    ),
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-6 py-6 sm:px-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Insights</h1>
          <p className="text-sm text-muted-foreground mt-1">{workspaceName}</p>
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          <div className="flex gap-0.5 p-0.5 rounded-lg bg-muted">
            {[7, 30, 90].map(d => (
              <Button
                key={d}
                variant={days === d ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setDays(d)}
                className="rounded-md"
              >
                {d}d
              </Button>
            ))}
          </div>

          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              {models.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-6 pt-4 sm:px-8">
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>{error}</span>
              <Button variant="ghost" size="sm" className="shrink-0 text-destructive hover:text-destructive" onClick={() => setError(null)}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Data source badges */}
      {contextData && (
        <div className="px-6 pt-4 sm:px-8 flex gap-2 flex-wrap items-center">
          <span className="text-xs text-muted-foreground mr-1">Data sources:</span>
          {dataSources.map(ds => (
            <Badge
              key={ds.label}
              variant={ds.active ? 'secondary' : 'outline'}
              className={cn(!ds.active && 'text-muted-foreground border-muted-foreground/30')}
            >
              {ds.active ? '●' : '○'} {ds.label}
            </Badge>
          ))}
          <span className="text-xs text-muted-foreground ml-2">
            {contextData.period.from} → {contextData.period.to}
          </span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="px-6 py-16 sm:px-8 text-center">
          <Skeleton className="h-10 w-10 rounded-full mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading workspace data...</p>
        </div>
      )}

      {/* KPI Dashboard */}
      {contextData && !loading && (
        <div className="p-5 sm:px-8">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            <KpiCard label="Net Sales" value={`${sym}${fmt(contextData.pnl.netSales)}`} sub={`${contextData.pnl.ordersCount} orders`} />
            <KpiCard label="CM1" value={`${sym}${fmt(contextData.pnl.cm1)}`} sub={contextData.pnl.cm1Margin != null ? `${contextData.pnl.cm1Margin.toFixed(1)}% margin` : undefined} />
            <KpiCard label="CM2" value={`${sym}${fmt(contextData.pnl.cm2)}`} sub={contextData.pnl.cm2Margin != null ? `${contextData.pnl.cm2Margin.toFixed(1)}% margin` : undefined} />
            <KpiCard label="CM3" value={`${sym}${fmt(contextData.pnl.cm3)}`} sub={contextData.pnl.cm3Margin != null ? `${contextData.pnl.cm3Margin.toFixed(1)}% margin` : undefined} />
            <KpiCard label="Net Profit" value={`${sym}${fmt(contextData.pnl.netProfit)}`} sub={contextData.pnl.netProfitMargin != null ? `${contextData.pnl.netProfitMargin.toFixed(1)}% margin` : undefined} />
            <KpiCard label="Ad Spend" value={`${sym}${fmt(contextData.ads.totalSpend)}`} sub={`ROAS: ${contextData.ads.blendedRoas?.toFixed(2) ?? '—'}x`} />
            <KpiCard label="AOV" value={`${sym}${fmt(contextData.analytics.avgAov, 2)}`} sub={`${contextData.analytics.totalOrders} orders`} />
            {contextData.orders.rtoPercent != null && (
              <KpiCard label="RTO" value={`${contextData.orders.rtoPercent.toFixed(1)}%`} sub={`${contextData.orders.rtoOrders} orders • ${sym}${fmt(contextData.orders.rtoValue)}`} />
            )}
            {contextData.cohorts && (
              <KpiCard label="CAC" value={`${sym}${fmt(contextData.cohorts.averageCac, 2)}`} sub={`${contextData.cohorts.avg90DayRepeat.toFixed(1)}% repeat`} />
            )}
            {contextData.timings && (
              <KpiCard label="1st→2nd" value={`${contextData.timings.median1to2} days`} sub={`${contextData.timings.secondOrdersPct.toFixed(1)}% return`} />
            )}
            {contextData.inventory && (
              <KpiCard label="Inventory" value={`${contextData.inventory.healthyStockCount} healthy`} sub={`${contextData.inventory.lowStockCount} low • ${contextData.inventory.deadStockCount} dead`} />
            )}
          </div>
        </div>
      )}

      {/* Tabs: Insights / Chat */}
      {contextData && !loading && (
        <div className="px-6 sm:px-8 min-w-0 overflow-hidden">
          <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'insights' | 'chat')}>
            <TabsList className="mb-5">
              <TabsTrigger value="insights">✨ AI Insights</TabsTrigger>
              <TabsTrigger value="chat">💬 AI Chat</TabsTrigger>
            </TabsList>

            <TabsContent value="insights" className="mt-0">
              <div className="flex gap-3 mb-5 items-center">
                <Button
                  onClick={generateInsights}
                  disabled={insightsLoading || !model}
                >
                  {insightsLoading ? 'Analyzing...' : 'Generate Insights'}
                </Button>
                {insights.length > 0 && (
                  <span className="text-sm text-muted-foreground">{insights.length} insight{insights.length !== 1 ? 's' : ''} found</span>
                )}
              </div>

              {insightsLoading && (
                <div className="py-10 text-center">
                  <Skeleton className="h-8 w-8 rounded-full mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">AI is analyzing your data across all sources...</p>
                </div>
              )}

              <div className="grid gap-3">
                {insights.map((insight, i) => (
                  <Card key={i} className={cn(
                    insight.severity === 'high' && 'border-destructive/50',
                    insight.severity === 'medium' && 'border-primary/30',
                  )}>
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex gap-2 items-center">
                          <span className="text-lg" aria-hidden>{insightTypeIcon(insight.insight_type)}</span>
                          <CardTitle className="text-base">{insight.title}</CardTitle>
                        </div>
                        <div className="flex gap-2 items-center shrink-0">
                          {insight.severity && (
                            <Badge variant={severityVariant(insight.severity)}>
                              {insight.severity}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {Math.round(insight.confidence * 100)}%
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0">
                      <p className="text-sm text-muted-foreground leading-relaxed">{insight.reason}</p>
                      <div className="flex gap-1.5 items-start">
                        <span className="text-primary shrink-0">→</span>
                        <p className="text-sm text-foreground leading-relaxed">{insight.recommendation}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {insights.length === 0 && !insightsLoading && (
                <p className="py-10 text-center text-muted-foreground text-sm">
                  Click &quot;Generate Insights&quot; to analyze your workspace data with AI
                </p>
              )}
            </TabsContent>

            <TabsContent value="chat" className="mt-0 w-full min-w-0 overflow-hidden">
              <ScrollArea className="w-full min-w-0 min-h-[400px] max-h-[500px] overflow-x-hidden rounded-lg border border-border mb-4">
                <div className="overflow-x-hidden w-full min-w-0 max-w-full">
                <div className="p-4 flex flex-col gap-3 min-w-0 w-full max-w-full">
                  {chatMessages.length === 0 && (
                    <div className="py-14 px-5 text-center">
                      <p className="text-3xl mb-2" aria-hidden>💬</p>
                      <p className="text-muted-foreground text-sm">Ask anything about your business data</p>
                      <div className="flex gap-2 justify-center mt-4 flex-wrap">
                        {['How is my CM3 trending?', 'What are my top spending campaigns?', 'Analyze my inventory health', 'Which cohort has best retention?'].map(q => (
                          <Button
                            key={q}
                            variant="outline"
                            size="sm"
                            onClick={() => setChatInput(q)}
                          >
                            {q}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex w-full min-w-0 max-w-full',
                        msg.role === 'user' ? 'justify-end' : 'justify-start',
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[80%] min-w-0 rounded-lg px-4 py-3 text-sm leading-relaxed break-words overflow-hidden [overflow-wrap:anywhere] [word-break:break-word]',
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground whitespace-pre-wrap'
                            : 'bg-muted text-foreground border border-border [&_ul]:list-disc [&_ol]:list-decimal',
                        )}
                      >
                        {msg.role === 'assistant' && chatLoading && i === chatMessages.length - 1 && !msg.content ? (
                          <span className="inline-flex gap-1 items-center py-1" aria-label="AI is thinking">
                            <span className="w-2 h-2 rounded-full bg-foreground/50 animate-bounce [animation-delay:0ms]" />
                            <span className="w-2 h-2 rounded-full bg-foreground/50 animate-bounce [animation-delay:150ms]" />
                            <span className="w-2 h-2 rounded-full bg-foreground/50 animate-bounce [animation-delay:300ms]" />
                          </span>
                        ) : msg.role === 'assistant' && msg.content ? (
                          <div className="chat-markdown">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          msg.content || ''
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                </div>
              </ScrollArea>

              <div className="flex gap-2">
                <Input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                  placeholder="Ask about your P&L, ads, cohorts, inventory..."
                  disabled={chatLoading}
                  className="flex-1"
                />
                <Button
                  onClick={sendChat}
                  disabled={chatLoading || !chatInput.trim()}
                  size="icon"
                  className="shrink-0"
                  aria-label="Send message"
                >
                  ↑
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}

      <div className="h-10" />
    </div>
  )
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="transition-colors hover:border-border/80">
      <CardHeader className="py-4 px-4 pb-0">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <CardTitle className="text-xl font-bold tabular-nums">{value}</CardTitle>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardHeader>
    </Card>
  )
}
