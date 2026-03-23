'use client'

import { useState } from 'react'
import {
  IconAlertTriangle,
  IconAlertCircle,
  IconBulb,
  IconTrendingUp,
  IconChevronDown,
  IconChevronUp,
  IconTargetArrow,
  IconSparkles,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'

export type InsightItem = {
  title: string
  severity: 'critical' | 'warning' | 'opportunity' | 'positive'
  confidence: number
  summary: string
  detail: string
  recommendation: string
  metrics: string[]
}

const severityConfig = {
  critical: {
    icon: IconAlertCircle,
    label: 'Critical',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-900/50',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400',
    iconColor: 'text-red-500',
    accentBar: 'bg-red-500',
  },
  warning: {
    icon: IconAlertTriangle,
    label: 'Warning',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-900/50',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
    iconColor: 'text-amber-500',
    accentBar: 'bg-amber-500',
  },
  opportunity: {
    icon: IconBulb,
    label: 'Opportunity',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-900/50',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400',
    iconColor: 'text-blue-500',
    accentBar: 'bg-blue-500',
  },
  positive: {
    icon: IconTrendingUp,
    label: 'Positive',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-900/50',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
    iconColor: 'text-emerald-500',
    accentBar: 'bg-emerald-500',
  },
}

const severityRingClass: Record<InsightItem['severity'], string> = {
  critical: 'text-red-500',
  warning: 'text-amber-500',
  opportunity: 'text-blue-500',
  positive: 'text-emerald-500',
}

function ConfidenceRing({
  value,
  severity,
}: {
  value: number
  severity: InsightItem['severity']
}) {
  const radius = 15
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (value / 100) * circumference
  const ringColor = severityRingClass[severity]

  return (
    <div
      className="relative inline-flex size-10 items-center justify-center"
      title={`${value}% confidence`}
    >
      <svg width="40" height="40" className="-rotate-90" aria-hidden>
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-muted/25"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className={ringColor}
        />
      </svg>
      <span className="absolute text-[11px] font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function InsightCard({ insight }: { insight: InsightItem }) {
  const [expanded, setExpanded] = useState(false)
  const config = severityConfig[insight.severity]
  const Icon = config.icon

  return (
    <div
      className={`relative overflow-hidden rounded-xl border shadow-sm transition-shadow hover:shadow-md ${config.bg} ${config.border}`}
    >
      <div className={`absolute inset-y-0 left-0 w-[3px] ${config.accentBar}`} />

      <div className="pl-4 pr-3 py-3.5 sm:pl-5">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background/70 ${config.border} border`}
          >
            <Icon className={`h-[18px] w-[18px] ${config.iconColor}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={`border-0 px-2 py-0 text-[10px] font-semibold uppercase tracking-wide ${config.badge}`}>
                {config.label}
              </Badge>
            </div>
            <h3 className="mt-1.5 text-[15px] font-semibold leading-snug tracking-tight text-foreground">
              {insight.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {insight.summary}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ConfidenceRing value={insight.confidence} severity={insight.severity} />
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <IconChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <IconChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="mt-3 ml-12 space-y-3">
            {/* Detail */}
            <p className="text-sm text-foreground/80 leading-relaxed">
              {insight.detail}
            </p>

            {/* Recommendation */}
            <div className="flex items-start gap-2 rounded-md bg-background/60 border px-3 py-2">
              <IconTargetArrow className="h-4 w-4 mt-0.5 shrink-0 text-[#96bf48]" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#96bf48] mb-0.5">
                  Recommendation
                </p>
                <p className="text-sm">{insight.recommendation}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function InsightCardList({
  insights,
  cached,
  model,
  loading,
  error,
  showListHeader = true,
}: {
  insights: InsightItem[]
  cached: boolean
  model?: string
  loading: boolean
  error: string | null
  /** When false, omit the “AI Insights” / cache row (e.g. sheet shows it in the header). */
  showListHeader?: boolean
}) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-lg border bg-muted/20 p-4 animate-pulse"
          >
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 rounded bg-muted/40" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 rounded bg-muted/40" />
                <div className="h-3 w-full rounded bg-muted/40" />
              </div>
              <div className="h-9 w-9 rounded-full bg-muted/40" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (insights.length === 0) return null

  return (
    <div className="space-y-3">
      {showListHeader && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <IconSparkles className="h-4 w-4 shrink-0 text-[#96bf48]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              AI Insights
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {cached && <span>Served from cache</span>}
            {model && model !== 'cache' && (
              <span className="opacity-50">{model.split('-').slice(0, 2).join(' ')}</span>
            )}
          </div>
        </div>
      )}
      {insights.map((insight, i) => (
        <InsightCard key={i} insight={insight} />
      ))}
    </div>
  )
}
