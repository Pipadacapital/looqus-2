import { TablePageSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  // Products: date range + group-by + search + columns picker + table
  return <TablePageSkeleton cols={7} rows={12} filterButtons={3} />
}
