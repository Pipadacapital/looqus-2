import { TablePageSkeleton } from '@/components/page-loading-skeleton'

// Generic fallback used for any route that doesn't have its own loading.tsx
export default function Loading() {
  return <TablePageSkeleton />
}
