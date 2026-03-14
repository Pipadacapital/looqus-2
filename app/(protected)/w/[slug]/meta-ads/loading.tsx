import { PageHeaderSkeleton, StatCardsSkeleton, FilterBarSkeleton, TableSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <PageHeaderSkeleton subtitle />
      <StatCardsSkeleton count={4} />
      <div className="rounded-xl border bg-card shadow-sm">
        <FilterBarSkeleton buttons={2} />
        <TableSkeleton rows={10} cols={6} />
      </div>
    </div>
  )
}
