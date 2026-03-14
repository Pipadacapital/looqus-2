import { PageHeaderSkeleton, StatCardsSkeleton, FilterBarSkeleton, TableSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <PageHeaderSkeleton subtitle />
      <StatCardsSkeleton count={5} />
      <div className="rounded-xl border bg-card shadow-sm">
        <FilterBarSkeleton buttons={3} />
        <TableSkeleton rows={15} cols={7} />
      </div>
    </div>
  )
}
