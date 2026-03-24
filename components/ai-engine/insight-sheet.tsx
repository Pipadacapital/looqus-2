'use client'

import { format } from 'date-fns'
import {
  IconSparkles,
  IconLoader2,
  IconRefresh,
  IconCalendarEvent,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { InsightCardList, type InsightItem } from '@/components/ai-engine/insight-cards'

const PAGE_TITLES: Record<string, string> = {
  analytics: 'Analytics Insights',
  pnl: 'P&L Insights',
  waterfall: 'Waterfall Insights',
  acquisition: 'Acquisition Insights',
  cohorts: 'Cohort Insights',
  'lifetime-value': 'LTV Insights',
  'meta-ads': 'Meta Ads Insights',
  'google-ads': 'Google Ads Insights',
  products: 'Product Insights',
  logistics: 'Logistics Insights',
  'rto-analytics': 'RTO Insights',
  'cod-prepaid': 'COD/Prepaid Insights',
  timings: 'Timing Insights',
  distributions: 'Distribution Insights',
  'email-sms': 'Email/SMS Insights',
}

const PAGE_DESCRIPTIONS: Record<string, string> = {
  analytics: 'Run AI analysis on your analytics data to evaluate performance, margins, and efficiency.',
  pnl: 'Run AI analysis on your P&L data to identify margin changes, cost drivers, and profitability trends.',
  waterfall: 'Run AI analysis on the full Gross Sales → Net Profit waterfall to identify the biggest cost drags, discount leakage, and new vs returning customer economics.',
  acquisition: 'Run AI analysis on your acquisition data to evaluate CAC efficiency, channel performance, and new customer unit economics.',
  cohorts: 'Run AI analysis on your cohort data to evaluate retention trends, payback speed, and LTV trajectory across monthly cohorts.',
  'lifetime-value': 'Run AI analysis on your LTV data to evaluate customer lifetime value trends and profitability.',
  'meta-ads': 'Run AI analysis on your Meta Ads data to evaluate campaign performance and ROAS.',
  'google-ads': 'Run AI analysis on your Google Ads data to evaluate campaign performance and ROAS.',
  products: 'Run AI analysis on your product data to identify top performers and margin opportunities.',
  logistics: 'Run AI analysis on your logistics data to evaluate delivery performance and courier efficiency.',
  'rto-analytics': 'Run AI analysis on your RTO data to identify return patterns and reduce losses.',
  'cod-prepaid': 'Run AI analysis on your payment mode data to evaluate COD vs prepaid trends.',
  timings: 'Run AI analysis on your repurchase timing data to identify optimal re-engagement windows.',
  distributions: 'Run AI analysis on your order distribution data to evaluate order value patterns.',
  'email-sms': 'Run AI analysis on your email/SMS campaign data to evaluate engagement and conversion.',
}

interface InsightSheetProps {
  page: string
  from: string
  to: string
  sheetOpen: boolean
  onSheetOpenChange: (open: boolean) => void
  insights: InsightItem[]
  loading: boolean
  error: string | null
  cached: boolean
  model: string
  dataThrough: string | null
  insufficientData: boolean
  isDone: boolean
  onGenerate: (forceRefresh?: boolean) => void
  /** Whether the page data is still loading */
  pageLoading?: boolean
}

export function InsightSheet({
  page,
  from,
  to,
  sheetOpen,
  onSheetOpenChange,
  insights,
  loading,
  error,
  cached,
  model,
  dataThrough,
  insufficientData,
  isDone,
  onGenerate,
  pageLoading,
}: InsightSheetProps) {
  const title = PAGE_TITLES[page] ?? `${page} Insights`
  const description = PAGE_DESCRIPTIONS[page] ?? 'Run AI analysis on your data.'
  const dataThroughDate = dataThrough ? new Date(`${dataThrough}T00:00:00`) : null
  const dataThroughLabel =
    dataThroughDate && !Number.isNaN(dataThroughDate.getTime())
      ? format(dataThroughDate, 'MMM d, yyyy')
      : null
  const hasContent = insights.length > 0
  const showGenerate = !hasContent && !loading && !error && !insufficientData
  const showRegenerate = hasContent || error || insufficientData

  return (
    <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
          {loading ? (
            <IconLoader2 className="h-4 w-4 animate-spin" />
          ) : (
            <IconSparkles className="h-4 w-4" />
          )}
          AI Insights
          {loading && (
            <span className="text-[10px] text-muted-foreground ml-0.5">
              generating...
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        overlayClassName="bg-black/45 backdrop-blur-[2px]"
        className={cn(
          'flex h-full w-full flex-col gap-0 overflow-hidden p-0',
          'rounded-l-2xl border-l bg-card shadow-2xl',
          'sm:max-w-[min(100vw-1rem,26rem)] md:max-w-[min(100vw-2rem,30rem)]'
        )}
      >
        <div className="shrink-0 border-b bg-gradient-to-b from-muted/50 to-background px-6 pb-5 pt-6 pr-14">
          <SheetHeader className="space-y-4 p-0 text-left">
            <div>
              <SheetTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#96bf48]/12">
                  <IconSparkles className="h-4 w-4 text-[#96bf48]" />
                </span>
                {title}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="mt-2 space-y-1">
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <IconCalendarEvent className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span className="tabular-nums">
                      {from} → {to}
                    </span>
                  </p>
                  {dataThroughLabel && !insufficientData && (
                    <p className="text-[11px] text-muted-foreground/70">
                      Based on data through {dataThroughLabel}
                    </p>
                  )}
                </div>
              </SheetDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {showGenerate && (
                <Button
                  size="sm"
                  onClick={() => onGenerate()}
                  disabled={loading || pageLoading}
                  className="gap-1.5 bg-[#96bf48] text-white hover:bg-[#86af38]"
                >
                  <IconSparkles className="h-4 w-4" />
                  Generate Insights
                </Button>
              )}
              {showRegenerate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onGenerate(true)}
                  disabled={loading}
                  className="gap-1.5 border-foreground/15 bg-background shadow-sm"
                >
                  {loading ? (
                    <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <IconRefresh className="h-3.5 w-3.5" />
                  )}
                  Regenerate
                </Button>
              )}
              {hasContent && cached && (
                <Badge
                  variant="secondary"
                  className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Served from cache
                </Badge>
              )}
              {hasContent && model && model !== 'cache' && (
                <span className="text-[10px] text-muted-foreground/70">
                  {model.split('-').slice(0, 2).join(' ')}
                </span>
              )}
            </div>
          </SheetHeader>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 px-6 py-5">
            <InsightCardList
              insights={insights}
              cached={cached}
              model={model}
              loading={loading}
              error={error}
              showListHeader={false}
            />

            {insufficientData && !loading && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-5">
                <div className="flex items-start gap-3">
                  <IconAlertTriangle className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Not enough data for this period
                    </p>
                    <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
                      Try selecting a longer date range, or wait for more data to sync.
                    </p>
                    {dataThroughLabel && (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                        Last available data: {dataThroughLabel}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!loading && !hasContent && !error && !insufficientData && (
              <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed bg-muted/15 px-6 py-14 text-center">
                <IconSparkles className="mb-4 h-11 w-11 text-[#96bf48]/35" />
                <p className="text-sm font-medium text-foreground">
                  Ready when you are
                </p>
                <p className="mt-1.5 max-w-[240px] text-xs leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
