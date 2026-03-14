import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { NotificationsLoader } from './notifications-loader'
import Loading from './loading'

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const workspace = await getCachedWorkspace(slug)
  if (!workspace) redirect('/')

  return (
    <Suspense fallback={<Loading />}>
      <NotificationsLoader slug={slug} />
    </Suspense>
  )
}
