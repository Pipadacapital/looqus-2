import { Skeleton } from '@/components/ui/skeleton'
import { PageHeaderSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <PageHeaderSkeleton subtitle />
      {/* Chat history placeholder */}
      <div className="flex flex-col gap-4 flex-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className={`flex gap-3 ${i % 2 === 0 ? '' : 'flex-row-reverse'}`}
          >
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="flex flex-col gap-1.5 max-w-[70%]">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              {i === 2 && <Skeleton className="h-4 w-3/6" />}
            </div>
          </div>
        ))}
      </div>
      {/* Input bar */}
      <div className="rounded-xl border bg-card shadow-sm p-4 flex items-center gap-3">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-10 rounded-lg" />
      </div>
    </div>
  )
}
