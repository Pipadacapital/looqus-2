import { Skeleton } from '@/components/ui/skeleton'
import { PageHeaderSkeleton, StatCardsSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <PageHeaderSkeleton subtitle />

      {/* Connection status cards */}
      <StatCardsSkeleton count={4} />

      {/* Quick metrics */}
      <div className="rounded-xl border bg-card shadow-sm p-6 flex flex-col gap-4">
        <Skeleton className="h-5 w-40" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
