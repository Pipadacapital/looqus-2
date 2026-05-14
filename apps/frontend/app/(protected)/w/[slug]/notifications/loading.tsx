import { Skeleton } from '@/components/ui/skeleton'
import { PageHeaderSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div className="flex items-center justify-between">
        <PageHeaderSkeleton />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="rounded-xl border bg-card shadow-sm">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-start gap-4 border-b last:border-0 px-6 py-4">
            <Skeleton className="h-9 w-9 rounded-full shrink-0 mt-0.5" />
            <div className="flex flex-col gap-2 flex-1">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
