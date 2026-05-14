import { TablePageSkeleton } from '@/components/page-loading-skeleton'

export default function Loading() {
  return <TablePageSkeleton cols={6} rows={10} filterButtons={2} />
}
