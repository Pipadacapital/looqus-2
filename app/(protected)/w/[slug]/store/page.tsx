import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { StoreLoader } from './store-loader'
import Loading from './loading'

export default async function StorePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const workspace = await getCachedWorkspace(slug)
  if (!workspace) redirect('/')

  return (
    <Suspense fallback={<Loading />}>
      <StoreLoader slug={slug} />
    </Suspense>
  )
}
