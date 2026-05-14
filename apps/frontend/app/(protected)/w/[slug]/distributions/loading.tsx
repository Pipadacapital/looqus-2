import { PageHeaderSkeleton, FilterBarSkeleton, ChartSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <PageHeaderSkeleton subtitle />
      <div className="rounded-xl border bg-card shadow-sm">
        <FilterBarSkeleton buttons={1} />
        <ChartSkeleton height={300} />
      </div>
      <div className="rounded-xl border bg-card shadow-sm">
        <FilterBarSkeleton buttons={1} />
        <ChartSkeleton height={300} />
      </div>
    </div>
  )
}
