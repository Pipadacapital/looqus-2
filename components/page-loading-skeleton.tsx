import { Skeleton } from '@/components/ui/skeleton'

/** Generic page header skeleton: title + optional subtitle */
export function PageHeaderSkeleton({ subtitle = false }: { subtitle?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-8 w-48" />
      {subtitle && <Skeleton className="h-4 w-32" />}
    </div>
  )
}

/** Filter bar skeleton: date pickers + buttons */
export function FilterBarSkeleton({ buttons = 2 }: { buttons?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-8 w-32" />
      {Array.from({ length: buttons }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-20" />
      ))}
      <div className="ml-auto flex items-center gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
      </div>
    </div>
  )
}

/** Table skeleton: header row + N data rows */
export function TableSkeleton({ rows = 10, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-full">
        {/* Header */}
        <div className="flex gap-4 border-b px-6 py-3">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
        {/* Rows */}
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4 border-b px-6 py-3">
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton key={j} className="h-4 flex-1" style={{ opacity: 1 - i * 0.06 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Stats cards row skeleton */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-5 flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  )
}

/** Chart area skeleton */
export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="px-6 py-4">
      <Skeleton className="w-full rounded-lg" style={{ height }} />
    </div>
  )
}

/** Full table-page skeleton: header + filter bar + table */
export function TablePageSkeleton({
  cols = 6,
  rows = 12,
  filterButtons = 2,
}: {
  cols?: number
  rows?: number
  filterButtons?: number
}) {
  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <PageHeaderSkeleton subtitle />
      <div className="rounded-xl border bg-card shadow-sm">
        <FilterBarSkeleton buttons={filterButtons} />
        <TableSkeleton rows={rows} cols={cols} />
      </div>
    </div>
  )
}
