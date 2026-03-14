import { TablePageSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  // PnL: date range + granularity toggle + columns picker + big table
  return <TablePageSkeleton cols={8} rows={14} filterButtons={3} />
}
