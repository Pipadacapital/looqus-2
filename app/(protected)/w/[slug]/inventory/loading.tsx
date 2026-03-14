import { TablePageSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  return <TablePageSkeleton cols={5} rows={12} filterButtons={2} />
}
