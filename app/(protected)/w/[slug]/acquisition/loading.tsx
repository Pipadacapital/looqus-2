import { PageHeaderSkeleton, FilterBarSkeleton, StatCardsSkeleton, ChartSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <PageHeaderSkeleton subtitle />
      <StatCardsSkeleton count={4} />
      <div className="rounded-xl border bg-card shadow-sm">
        <FilterBarSkeleton buttons={2} />
        <ChartSkeleton height={280} />
      </div>
    </div>
  )
}
