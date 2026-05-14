'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DashboardMetricsGrid } from '@/components/dashboard/dashboard-metrics-grid'

interface DashboardContentProps {
  workspaceSlug: string
  workspaceId: string
  workspaceName: string
  connectionError?: string | null
  // Kept optional for compatibility with existing loader usage.
  isSuperadmin?: boolean
  shopifyConnection?: unknown
  metaConnection?: unknown
  googleConnection?: unknown
  shiprocketConnection?: unknown
}

type AnalyticsResponse = {
  summary?: Record<string, unknown> | null
}

type CodPrepaidResponse = Record<string, unknown> | null
type AcquisitionResponse = Record<string, unknown> | null
type RtoResponse = Record<string, unknown> | null

function getDefaultRange() {
  const toDate = new Date()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - 29)
  return {
    from: format(fromDate, 'yyyy-MM-dd'),
    to: format(toDate, 'yyyy-MM-dd'),
  }
}

export function DashboardContent({
  workspaceSlug,
  workspaceId,
  workspaceName,
  connectionError = null,
}: DashboardContentProps) {
  const defaults = useMemo(() => getDefaultRange(), [])
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [showCustomizePanel, setShowCustomizePanel] = useState(false)
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  const [codData, setCodData] = useState<CodPrepaidResponse>(null)
  const [acquisitionData, setAcquisitionData] = useState<AcquisitionResponse>(null)
  const [rtoData, setRtoData] = useState<RtoResponse>(null)
  const [loading, setLoading] = useState(true)

  const setPreset = (days: number) => {
    const toDate = new Date()
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - (days - 1))
    setFrom(format(fromDate, 'yyyy-MM-dd'))
    setTo(format(toDate, 'yyyy-MM-dd'))
  }

  const setYesterday = () => {
    const date = new Date()
    date.setDate(date.getDate() - 1)
    const value = format(date, 'yyyy-MM-dd')
    setFrom(value)
    setTo(value)
  }

  useEffect(() => {
    const controller = new AbortController()

    setLoading(true)
    Promise.all([
      fetch(
        `/api/workspaces/${workspaceSlug}/shopify-analytics?from=${from}&to=${to}`,
        { signal: controller.signal }
      ).then((res) => res.json()),
      fetch(
        `/api/workspaces/${workspaceSlug}/cod-prepaid-analytics?from=${from}&to=${to}`,
        { signal: controller.signal }
      ).then((res) => res.json()),
      fetch(
        `/api/workspaces/${workspaceSlug}/acquisition?from=${from}&to=${to}`,
        { signal: controller.signal }
      ).then((res) => res.json()),
      fetch(
        `/api/workspaces/${workspaceSlug}/rto-analytics?from=${from}&to=${to}`,
        { signal: controller.signal }
      ).then((res) => res.json()),
    ])
      .then(([analyticsRes, codRes, acquisitionRes, rtoRes]) => {
        setAnalytics(analyticsRes ?? null)
        setCodData(codRes ?? null)
        setAcquisitionData(acquisitionRes ?? null)
        setRtoData(rtoRes ?? null)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAnalytics(null)
          setCodData(null)
          setAcquisitionData(null)
          setRtoData(null)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [workspaceSlug, from, to])

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

      {connectionError && (connectionError === 'state_mismatch' || connectionError === 'shop_mismatch') && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Shopify connection could not be completed. Try again from{' '}
          <Link href={`/w/${workspaceSlug}/settings/integrations`} className="font-medium underline underline-offset-2">
            Settings → Integrations
          </Link>
          .
        </div>
      )}

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="border-b px-6 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="text-xs text-muted-foreground" htmlFor="dashboard-from">
                  From
                </label>
                <input
                  id="dashboard-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground" htmlFor="dashboard-to">
                  To
                </label>
                <input
                  id="dashboard-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-1 pb-0.5">
                <Button variant="outline" size="sm" onClick={setYesterday}>
                  Yesterday
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPreset(7)}>
                  7D
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPreset(30)}>
                  30D
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPreset(90)}>
                  90D
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPreset(365)}>
                  1Y
                </Button>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCustomizePanel((prev) => !prev)}
            >
              + Customize
            </Button>
          </div>
        </div>
        <div className="px-6 py-4">
          <DashboardMetricsGrid
            workspaceSlug={workspaceSlug}
            workspaceId={workspaceId}
            from={from}
            to={to}
            analyticsData={analytics}
            codData={codData}
            acquisitionData={acquisitionData}
            rtoData={rtoData}
            loading={loading}
            showCustomizePanel={showCustomizePanel}
          />
        </div>
      </div>
    </div>
  )
}
