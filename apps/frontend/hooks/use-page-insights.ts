'use client'

import { useCallback, useEffect, useState } from 'react'
import { useInsightJobs, type InsightItem } from '@/stores/insight-jobs'

/**
 * Hook that connects a page's insight Sheet to the global Zustand job store.
 * Replaces the per-page local fetch logic with job-based background generation.
 */
export function usePageInsights(
  workspaceSlug: string,
  page: string,
  from: string,
  to: string
) {
  const jobKey = `${workspaceSlug}:${page}`
  const job = useInsightJobs((s) => s.jobs[jobKey])
  const submitJob = useInsightJobs((s) => s.submitJob)
  const clearJob = useInsightJobs((s) => s.clearJob)

  const [sheetOpen, setSheetOpen] = useState(false)

  // When sheet opens and no job exists for this range, auto-fetch
  useEffect(() => {
    if (!sheetOpen) return
    if (job && (job.from === from && job.to === to)) return // already have a job for this range
    if (job && (job.status === 'pending' || job.status === 'processing')) return // running

    // No job or different range — submit to check cache
    submitJob(workspaceSlug, page, from, to)
  }, [sheetOpen, workspaceSlug, page, from, to, job, submitJob])

  // Clear job when date range changes
  useEffect(() => {
    if (job && (job.from !== from || job.to !== to)) {
      clearJob(jobKey)
    }
  }, [from, to, job, jobKey, clearJob])

  const generate = useCallback(
    (forceRefresh = false) => {
      submitJob(workspaceSlug, page, from, to, forceRefresh)
    },
    [submitJob, workspaceSlug, page, from, to]
  )

  const insights: InsightItem[] = job?.insights ?? []
  const loading = job?.status === 'pending' || job?.status === 'processing'
  const error = job?.status === 'failed' ? (job.error || 'Generation failed') : null
  const cached = job?.model === 'cache'
  const model = job?.model ?? ''
  const dataThrough = job?.dataThrough ?? null
  const insufficientData = false // TODO: detect from job error content
  const isDone = job?.status === 'done'

  return {
    sheetOpen,
    setSheetOpen,
    insights,
    loading,
    error,
    cached,
    model,
    dataThrough,
    insufficientData,
    isDone,
    generate,
  }
}
