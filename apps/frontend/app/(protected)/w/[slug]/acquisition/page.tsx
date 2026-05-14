import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { AcquisitionLoader } from './acquisition-loader'
import Loading from './loading'

export default async function AcquisitionPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const workspace = await getCachedWorkspace(slug)
  if (!workspace) redirect('/')

  return (
    <Suspense fallback={<Loading />}>
      <AcquisitionLoader slug={slug} />
    </Suspense>
  )
}
