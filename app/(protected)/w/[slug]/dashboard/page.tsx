import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { DashboardLoader } from './dashboard-loader'
import Loading from './loading'

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { slug } = await params
  const { error: connectionError } = await searchParams

  const workspace = await getCachedWorkspace(slug)
  if (!workspace) redirect('/')

  return (
    <Suspense fallback={<Loading />}>
      <DashboardLoader slug={slug} connectionError={connectionError ?? null} />
    </Suspense>
  )
}
