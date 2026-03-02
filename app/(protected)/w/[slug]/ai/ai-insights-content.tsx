'use client'

import { useState, useCallback, useEffect } from 'react'
import { IconBrain, IconLoader2, IconSparkles, IconSend } from '@tabler/icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type AiInsight = {
  insight_type: string
  title: string
  reason: string
  recommendation: string
  confidence: number
  severity?: 'high' | 'medium' | 'low'
}

type Trend = {
  netSalesPctChange: number
  ordersPctChange: number
  aovPctChange: number
  adSpendPctChange: number
  blendedRoasPctChange: number | null
  cm2PctChange: number
  cm3PctChange: number
}

interface AiInsightsContentProps {
  workspaceSlug: string
  workspaceName: string
}

function TrendPill({ value }: { value: number }) {
  const s = value >= 0 ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`
  const positive = value > 0
  const negative = value < 0
  return (
    <span
      className={cn(
        'text-xs font-medium tabular-nums',
        positive && 'text-emerald-600 dark:text-emerald-400',
        negative && 'text-red-600 dark:text-red-400',
        !positive && !negative && 'text-muted-foreground'
      )}
    >
      {s}
    </span>
  )
}

function severityStyles(severity?: 'high' | 'medium' | 'low') {
  switch (severity) {
    case 'high':
      return 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20'
    case 'medium':
      return 'border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/20'
    case 'low':
      return 'border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20'
    default:
      return 'border-l-violet-500 bg-muted/30 dark:bg-muted/20'
  }
}

export function AiInsightsContent({
  workspaceSlug,
  workspaceName,
}: AiInsightsContentProps) {
  const [days, setDays] = useState(30)
  const [model, setModel] = useState<string>('')
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingModels, setLoadingModels] = useState(true)
  const [insights, setInsights] = useState<AiInsight[]>([])
  const [trend, setTrend] = useState<Trend | null>(null)
  const [period, setPeriod] = useState<{ from: string; to: string; days: number } | null>(null)
  const [modelUsed, setModelUsed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')

  const fetchModels = useCallback(() => {
    setLoadingModels(true)
    fetch(`/api/workspaces/${workspaceSlug}/ai/models`)
      .then((res) => res.json())
      .then((data) => {
        if (data.models?.length) {
          setModels(data.models)
          if (!model && data.models[0]) setModel(data.models[0].id)
        }
      })
      .finally(() => setLoadingModels(false))
  }, [workspaceSlug, model])

  const fetchInsights = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ days: String(days) })
    if (model) params.set('model', model)
    fetch(`/api/workspaces/${workspaceSlug}/ai/insights?${params}`)
      .then((res) => res.json())
      .then((data) => {
        setInsights(data.insights ?? [])
        setTrend(data.trend ?? null)
        setPeriod(data.period ?? null)
        setModelUsed(data.modelUsed ?? null)
        setError(data.error ?? null)
      })
      .catch(() => {
        setError('Failed to load insights')
        setInsights([])
        setTrend(null)
        setPeriod(null)
      })
      .finally(() => setLoading(false))
  }, [workspaceSlug, days, model])

  const handleChatSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const msg = chatInput.trim()
      if (!msg || chatLoading || !workspaceSlug) return
      setChatInput('')
      setChatMessages((prev) => [...prev, { role: 'user', content: msg }, { role: 'assistant', content: '' }])
      setStreamingContent('')
      setChatLoading(true)
      try {
        const res = await fetch(`/api/workspaces/${workspaceSlug}/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            messages: chatMessages,
            model: model || undefined,
            days,
            stream: true,
          }),
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
    },
    [workspaceSlug, chatMessages, model, days, chatLoading, chatInput]
  )

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10">
            <IconBrain className="h-5 w-5 text-violet-600" />
          </span>
          AI Insights
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {workspaceName} · Triple Whale–style insights from your stored metrics
        </p>
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10">
            <IconSparkles className="h-5 w-5 text-violet-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Generate insights</p>
            <p className="text-xs text-muted-foreground">
              Uses workspace daily metrics. Run the nightly metrics job or populate script for data.
            </p>
          </div>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Period</span>
              <Select
                value={String(days)}
                onValueChange={(v) => setDays(Number(v))}
              >
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Model</span>
              <Select
                value={model || (models[0]?.id ?? '')}
                onValueChange={setModel}
                disabled={loadingModels || models.length === 0}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={loadingModels ? 'Loading…' : 'Select model'} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {models.length === 0 && !loadingModels && (
                <span className="text-xs text-muted-foreground">Start Ollama for models</span>
              )}
            </div>
            <Button
              onClick={fetchInsights}
              disabled={loading}
            >
              {loading ? (
                <>
                  <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <IconSparkles className="mr-2 h-4 w-4" />
                  Generate insights
                </>
              )}
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {period && (
            <p className="text-xs text-muted-foreground">
              Period: {period.from} → {period.to}
              {modelUsed && ` · Model: ${modelUsed}`}
            </p>
          )}

          {trend && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Trend vs prior period
              </p>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Net sales</span>
                  <TrendPill value={trend.netSalesPctChange} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Orders</span>
                  <TrendPill value={trend.ordersPctChange} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">AOV</span>
                  <TrendPill value={trend.aovPctChange} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Ad spend</span>
                  <TrendPill value={trend.adSpendPctChange} />
                </div>
                {trend.blendedRoasPctChange != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">ROAS</span>
                    <TrendPill value={trend.blendedRoasPctChange} />
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">CM2</span>
                  <TrendPill value={trend.cm2PctChange} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">CM3</span>
                  <TrendPill value={trend.cm3PctChange} />
                </div>
              </div>
            </div>
          )}

          {insights.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Insights
              </p>
              <ul className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
                {insights.map((insight, i) => (
                  <li
                    key={i}
                    className={cn(
                      'rounded-lg border-l-4 p-4 text-left transition-colors',
                      severityStyles(insight.severity)
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {insight.insight_type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Math.round(insight.confidence * 100)}% confidence
                      </span>
                    </div>
                    <h3 className="font-medium mt-1.5">{insight.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{insight.reason}</p>
                    <p className="text-sm mt-2">
                      <span className="text-muted-foreground">Recommendation: </span>
                      <span className="font-medium">{insight.recommendation}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!loading && insights.length === 0 && !error && period && (
            <p className="text-sm text-muted-foreground py-4">
              No insights generated yet. Click &quot;Generate insights&quot; or ensure you have
              workspace daily metrics for this period.
            </p>
          )}

          {!loading && !period && !error && (
            <p className="text-sm text-muted-foreground py-4">
              Select period and model, then click &quot;Generate insights&quot;. Ensure Ollama is
              running (e.g. <code className="rounded bg-muted px-1 text-xs">ollama run llama3.2</code>)
              and workspace daily metrics are populated.
            </p>
          )}
          <div className="border-t pt-4 mt-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Ask about your data
            </p>
            <div className="rounded-lg border bg-muted/20 min-h-[120px] max-h-[280px] overflow-y-auto flex flex-col">
              {chatMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3">
                  e.g. &quot;Why is my ROAS low?&quot;, &quot;Summarize last 30 days&quot;, &quot;How is CM3 trending?&quot;
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
            <form onSubmit={handleChatSubmit} className="flex gap-2 relative z-10">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about ROAS, CM, RTO, sales..."
                className="flex-1"
                disabled={chatLoading}
              />
              <Button
                type="submit"
                size="icon"
                disabled={chatLoading}
                className="min-w-9 min-h-9 shrink-0 cursor-pointer"
                aria-label="Send message"
              >
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
    </div>
  )
}
