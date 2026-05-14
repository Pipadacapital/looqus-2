'use client'

import { useState } from 'react'
import { useInsightJobs, type InsightJob } from '@/stores/insight-jobs'
import { useWorkspace } from '@/hooks/use-workspace'
import {
  IconSparkles,
  IconCheck,
  IconX,
  IconLoader2,
  IconExternalLink,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { InsightCardList } from '@/components/ai-engine/insight-cards'
import { cn } from '@/lib/utils'
import Link from 'next/link'

const AI_DISPLAY_NAME = process.env.NEXT_PUBLIC_AI_NAME ?? 'AI'

const PAGE_LABELS: Record<string, string> = {
  analytics: 'Analytics',
  pnl: 'P&L',
  waterfall: 'Waterfall',
  acquisition: 'Acquisition',
  cohorts: 'Cohorts',
  'lifetime-value': 'LTV',
  'meta-ads': 'Meta Ads',
  'google-ads': 'Google Ads',
  products: 'Products',
  logistics: 'Logistics',
  'rto-analytics': 'RTO',
  'cod-prepaid': 'COD/Prepaid',
  'pincode-intelligence': 'Pincode Intelligence',
  timings: 'Timings',
  distributions: 'Distributions',
  'email-sms': 'Email/SMS',
}

function JobRow({
  job,
  onClear,
  onOpen,
}: {
  job: InsightJob
  onClear: () => void
  onOpen: () => void
}) {
  const isActive = job.status === 'pending' || job.status === 'processing'
  const isDone = job.status === 'done'
  const isFailed = job.status === 'failed'

  return (
    <div
      className={cn(
        'flex items-center gap-3 py-2 rounded-md transition-colors',
        isDone && 'cursor-pointer -mx-1 px-1 hover:bg-muted/60'
      )}
      onClick={isDone ? onOpen : undefined}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {PAGE_LABELS[job.page] ?? job.page}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {job.from} → {job.to}
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isActive && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            Generating
          </span>
        )}
        {isDone && (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <IconCheck className="h-3.5 w-3.5" />
            View
          </span>
        )}
        {isFailed && (
          <span className="flex items-center gap-1 text-xs text-red-500">
            <IconX className="h-3.5 w-3.5" />
            Failed
          </span>
        )}
        {!isActive && (
          <button
            onClick={(e) => { e.stopPropagation(); onClear() }}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-0.5"
          >
            <IconX className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

export function InsightJobIndicator() {
  const { current } = useWorkspace()
  const jobs = useInsightJobs((s) => s.jobs)
  const clearJob = useInsightJobs((s) => s.clearJob)

  const [activeJob, setActiveJob] = useState<InsightJob | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const workspaceJobs = Object.entries(jobs)
    .filter(([, job]) => job.workspaceSlug === current.slug)
    .sort(([, a], [, b]) => b.startedAt - a.startedAt)

  if (workspaceJobs.length === 0) return null

  const activeCount = workspaceJobs.filter(
    ([, j]) => j.status === 'pending' || j.status === 'processing'
  ).length
  const hasReady = workspaceJobs.some(([, j]) => j.status === 'done')

  const openSheet = (key: string, job: InsightJob) => {
    setActiveKey(key)
    setActiveJob(job)
    setSheetOpen(true)
  }

  // Keep activeJob in sync with store updates while sheet is open
  const liveJob = activeKey ? jobs[activeKey] ?? activeJob : activeJob

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'relative gap-1.5 h-8 px-2.5',
              activeCount > 0 && 'text-[#96bf48]',
              hasReady && activeCount === 0 && 'text-green-600 dark:text-green-400'
            )}
          >
            {activeCount > 0 ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : (
              <IconSparkles className="h-4 w-4" />
            )}
            <span className="text-xs font-medium">
              {activeCount > 0
                ? `Generating${activeCount > 1 ? ` (${activeCount})` : ''}...`
                : `${AI_DISPLAY_NAME} Ready`}
            </span>
            {activeCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#96bf48] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#96bf48]" />
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            {AI_DISPLAY_NAME} Insight Jobs
          </p>
          <div className="divide-y">
            {workspaceJobs.map(([key, job]) => (
              <JobRow
                key={key}
                job={job}
                onClear={() => clearJob(key)}
                onOpen={() => openSheet(key, job)}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Global insight sheet — renders insights without navigating away */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg flex min-h-0 flex-col p-0">
          <SheetHeader className="px-5 pt-5 pb-4 border-b shrink-0">
            <div className="flex items-start gap-4">
              <div>
                <SheetTitle className="flex items-center gap-2 text-base">
                  <IconSparkles className="h-4 w-4 text-[#96bf48]" />
                  {liveJob ? PAGE_LABELS[liveJob.page] ?? liveJob.page : ''} {AI_DISPLAY_NAME} Insights
                </SheetTitle>
                {liveJob && (
                  <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                    {liveJob.from} → {liveJob.to}
                  </p>
                )}
              </div>
              {liveJob && (
                <Link
                  href={`/w/${liveJob.workspaceSlug}/${liveJob.page}`}
                  className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                >
                  Go to page
                  <IconExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="px-5 py-4">
              {liveJob && (
                <InsightCardList
                  insights={liveJob.insights ?? []}
                  cached={liveJob.model === 'cache'}
                  model={liveJob.model ?? ''}
                  loading={liveJob.status === 'pending' || liveJob.status === 'processing'}
                  error={liveJob.status === 'failed' ? (liveJob.error ?? 'Generation failed') : null}
                  showListHeader={false}
                />
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  )
}
