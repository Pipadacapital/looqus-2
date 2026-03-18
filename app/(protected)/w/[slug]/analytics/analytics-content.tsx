'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { IconChartLine, IconLoader2, IconPlugConnected } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
import {
  DateRangeFilter,
  AnalyticsMetricsCards,
  type ShopifyAnalyticsSummary,
} from '@/components/analytics'

type ShopifyConnectionInfo = {
  id: string
  shopDomain: string
  status: string
  lastSyncAt: string | null
}

type DailyRow = {
  date: string
  netSales: number
  grossSales: number
  totalTax: number
  totalDiscount: number
  ordersCount: number
  aov: number
  currency: string
  cogs: number
  shipping: number
  packaging: number
  websiteCharges: number
  cm1: number
}

interface AnalyticsContentProps {
  workspaceSlug: string
  workspaceName: string
  shopifyConnection: ShopifyConnectionInfo | null
}

export function AnalyticsContent({
  workspaceSlug,
  workspaceName,
  shopifyConnection,
}: AnalyticsContentProps) {
  const [analyticsFrom, setAnalyticsFrom] = useState<string>(() =>
    format(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')
  )
  const [analyticsTo, setAnalyticsTo] = useState<string>(() =>
    format(new Date(), 'yyyy-MM-dd')
  )
  const [shopifyAnalytics, setShopifyAnalytics] = useState<{
    daily: DailyRow[]
    summary: ShopifyAnalyticsSummary | null
    loading: boolean
    error: string | null
  }>(() => ({
    daily: [],
    summary: null,
    loading: !!shopifyConnection?.id,
    error: null,
  }))

  const handleFromChange = (value: string) => {
    setAnalyticsFrom(value)
    setShopifyAnalytics((prev) => ({ ...prev, loading: true, error: null }))
  }

  const handleToChange = (value: string) => {
    setAnalyticsTo(value)
    setShopifyAnalytics((prev) => ({ ...prev, loading: true, error: null }))
  }

  useEffect(() => {
    if (!shopifyConnection?.id || !workspaceSlug || !analyticsFrom || !analyticsTo)
      return
    fetch(
      `/api/workspaces/${workspaceSlug}/shopify-analytics?from=${analyticsFrom}&to=${analyticsTo}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setShopifyAnalytics({
            daily: [],
            summary: null,
            loading: false,
            error: data.error,
          })
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
        setShopifyAnalytics((prev) => ({
          ...prev,
          loading: false,
          error: 'Failed to load analytics',
        }))
      })
  }, [workspaceSlug, shopifyConnection?.id, analyticsFrom, analyticsTo])

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconChartLine className="h-6 w-6 text-[#96bf48]" />
          Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {workspaceName}
          {shopifyConnection?.lastSyncAt && (
            <>
              {' · '}
              Last refreshed:{' '}
              {format(new Date(shopifyConnection.lastSyncAt), 'MMM d, h:mm a')}
            </>
          )}
        </p>
      </div>

      {!shopifyConnection ? (
        <div className="rounded-xl border bg-card shadow-sm p-8 text-center">
          <p className="text-sm font-medium mb-1">No store connected</p>
          <p className="text-xs text-muted-foreground mb-4">
            Connect your Shopify store from the dashboard to view analytics.
          </p>
          <Button asChild>
            <Link href={`/w/${workspaceSlug}/dashboard`}>
              <IconPlugConnected className="mr-1.5 h-4 w-4" />
              Go to dashboard
            </Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#96bf48]/10">
              <IconChartLine className="h-5 w-5 text-[#96bf48]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Date range</p>
              <p className="text-xs text-muted-foreground">
                Select from / to dates or use presets (Yesterday, 7D, 30D, 90D).
              </p>
            </div>
          </div>
          <div className="px-6 py-4 space-y-6">
            <DateRangeFilter
              from={analyticsFrom}
              to={analyticsTo}
              onFromChange={handleFromChange}
              onToChange={handleToChange}
              fromId="analytics-page-from"
              toId="analytics-page-to"
            />

            {shopifyAnalytics.loading ? (
              <div className="flex items-center justify-center py-12">
                <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : shopifyAnalytics.error ? (
              <p className="text-sm text-muted-foreground py-4">
                {shopifyAnalytics.error}
              </p>
            ) : shopifyAnalytics.summary ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Goals vs actual (RAG) use the period containing the range end — set targets in{' '}
                  <Link
                    href={`/w/${workspaceSlug}/settings/goals`}
                    className="underline font-medium text-foreground"
                  >
                    Settings → Goals
                  </Link>
                  .
                </p>
                <AnalyticsMetricsCards summary={shopifyAnalytics.summary} />

                {shopifyAnalytics.daily.length > 0 && (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                      Net sales over time
                    </p>
                    <ChartContainer
                      config={{
                        netSales: { label: 'Net sales', color: '#96bf48' },
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
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-muted"
                        />
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
                          tickFormatter={(v) =>
                            `${
                              shopifyAnalytics.summary?.currency === 'INR'
                                ? '₹'
                                : '$'
                            }${(v / 1000).toFixed(0)}k`
                          }
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(v) => [
                                `${
                                  shopifyAnalytics.summary?.currency === 'INR'
                                    ? '₹'
                                    : '$'
                                }${Number(v).toLocaleString('en-IN', {
                                  maximumFractionDigits: 0,
                                })}`,
                                'Net sales',
                              ]}
                              labelFormatter={(_, payload) =>
                                payload?.[0]?.payload?.date
                                  ? format(
                                      new Date(payload[0].payload.date),
                                      'MMM d, yyyy'
                                    )
                                  : ''
                              }
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
                )}

                {shopifyAnalytics.daily.length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No daily data for this range. Sync Shopify from the dashboard
                    or run &quot;Refresh analytics&quot; in Admin.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-4">
                No analytics data yet. Sync your Shopify store from the
                dashboard, then refresh analytics from Admin if needed.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
