import { PageHeaderSkeleton, StatCardsSkeleton, TableSkeleton } from '@/components/page-loading-skeleton'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div className="flex items-center justify-between">
        <PageHeaderSkeleton subtitle />
        <Skeleton className="h-8 w-24" />
      </div>
      <StatCardsSkeleton count={3} />
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-24" />
        </div>
        <TableSkeleton rows={10} cols={5} />
      </div>
    </div>
  )
}
