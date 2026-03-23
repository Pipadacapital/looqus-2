import { create } from 'zustand'

export type InsightJobStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface InsightJob {
  /** DB row id */
  jobId: string
  workspaceSlug: string
  page: string
  from: string
  to: string
  status: InsightJobStatus
  /** Populated when done */
  insights: InsightItem[] | null
  model: string | null
  dataThrough: string | null
  error: string | null
  /** Timestamp when job was submitted */
  startedAt: number
}

export interface InsightItem {
  title: string
  severity: 'critical' | 'warning' | 'opportunity' | 'positive'
  confidence: number
  summary: string
  detail: string
  recommendation: string
  metrics: string[]
}

interface InsightJobsState {
  /** Active jobs keyed by `${workspaceSlug}:${page}` */
  jobs: Record<string, InsightJob>
  /** Polling interval ids keyed by job composite key */
  _intervals: Record<string, ReturnType<typeof setInterval>>

  /** Submit a new insight generation job */
  submitJob: (workspaceSlug: string, page: string, from: string, to: string, forceRefresh?: boolean) => Promise<void>
  /** Called by polling to update job state */
  _updateJob: (key: string, update: Partial<InsightJob>) => void
  /** Start polling for a job */
  _startPolling: (key: string, workspaceSlug: string, jobId: string) => void
  /** Stop polling for a job */
  _stopPolling: (key: string) => void
  /** Clear a completed/failed job */
  clearJob: (key: string) => void
  /** Get all active jobs for a workspace */
  getActiveJobs: (workspaceSlug: string) => InsightJob[]
}

const POLL_INTERVAL_MS = 3000

export const useInsightJobs = create<InsightJobsState>((set, get) => ({
  jobs: {},
  _intervals: {},

  submitJob: async (workspaceSlug, page, from, to, forceRefresh = false) => {
    const key = `${workspaceSlug}:${page}`

    // Don't submit if already running
    const existing = get().jobs[key]
    if (existing && (existing.status === 'pending' || existing.status === 'processing')) {
      return
    }

    // Optimistic: set pending state immediately
    set((state) => ({
      jobs: {
        ...state.jobs,
        [key]: {
          jobId: '',
          workspaceSlug,
          page,
          from,
          to,
          status: 'pending',
          insights: null,
          model: null,
          dataThrough: null,
          error: null,
          startedAt: Date.now(),
        },
      },
    }))

    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/ai-engine/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, from, to, forceRefresh }),
      })

      const data = await res.json()

      if (!res.ok) {
        set((state) => ({
          jobs: {
            ...state.jobs,
            [key]: { ...state.jobs[key], status: 'failed', error: data.error || 'Failed to start job' },
          },
        }))
        return
      }

      // If the response already has insights (cache hit), we're done
      if (data.status === 'done') {
        set((state) => ({
          jobs: {
            ...state.jobs,
            [key]: {
              ...state.jobs[key],
              jobId: data.jobId,
              status: 'done',
              insights: data.insights ?? null,
              model: data.model ?? null,
              dataThrough: data.dataThrough ?? null,
            },
          },
        }))
        return
      }

      // Job was created — start polling
      set((state) => ({
        jobs: {
          ...state.jobs,
          [key]: {
            ...state.jobs[key],
            jobId: data.jobId,
            status: data.status ?? 'processing',
          },
        },
      }))

      get()._startPolling(key, workspaceSlug, data.jobId)
    } catch {
      set((state) => ({
        jobs: {
          ...state.jobs,
          [key]: { ...state.jobs[key], status: 'failed', error: 'Network error' },
        },
      }))
    }
  },

  _updateJob: (key, update) => {
    set((state) => ({
      jobs: {
        ...state.jobs,
        [key]: { ...state.jobs[key], ...update },
      },
    }))
  },

  _startPolling: (key, workspaceSlug, jobId) => {
    // Clear any existing interval
    get()._stopPolling(key)

    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceSlug}/ai-engine/jobs/${jobId}`
        )
        const data = await res.json()

        if (!res.ok) {
          get()._updateJob(key, { status: 'failed', error: data.error || 'Poll failed' })
          get()._stopPolling(key)
          return
        }

        if (data.status === 'done') {
          get()._updateJob(key, {
            status: 'done',
            insights: data.insights ?? null,
            model: data.model ?? null,
            dataThrough: data.dataThrough ?? null,
          })
          get()._stopPolling(key)
        } else if (data.status === 'failed') {
          get()._updateJob(key, {
            status: 'failed',
            error: data.error || 'Generation failed',
          })
          get()._stopPolling(key)
        } else {
          get()._updateJob(key, { status: data.status })
        }
      } catch {
        // Network error during poll — don't fail the job, just keep trying
      }
    }, POLL_INTERVAL_MS)

    set((state) => ({
      _intervals: { ...state._intervals, [key]: interval },
    }))
  },

  _stopPolling: (key) => {
    const interval = get()._intervals[key]
    if (interval) {
      clearInterval(interval)
      set((state) => {
        const { [key]: _, ...rest } = state._intervals
        return { _intervals: rest }
      })
    }
  },

  clearJob: (key) => {
    get()._stopPolling(key)
    set((state) => {
      const { [key]: _, ...rest } = state.jobs
      return { jobs: rest }
    })
  },

  getActiveJobs: (workspaceSlug) => {
    return Object.values(get().jobs).filter(
      (j) => j.workspaceSlug === workspaceSlug && (j.status === 'pending' || j.status === 'processing')
    )
  },
}))
