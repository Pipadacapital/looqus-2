import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto flex w-full justify-center items-center flex-col gap-10 py-4 md:py-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="w-full rounded-xl border bg-card shadow-sm p-6 flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9 w-full max-w-sm" />
              </div>
            ))}
          </div>
          <Skeleton className="h-9 w-24" />
        </div>
      ))}
    </div>
  )
}
