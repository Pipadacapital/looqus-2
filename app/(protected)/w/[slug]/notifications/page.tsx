import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { NotificationsContent } from './notifications-content'

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
  })

  if (!workspace) redirect('/')

  const notifications = await prisma.notification.findMany({
    where: {
      userId: user.id,
      workspaceId: workspace.id,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      actionUrl: true,
      read: true,
      metadata: true,
      createdAt: true,
      readAt: true,
      workspaceId: true,
    },
  })

  return (
    <NotificationsContent
      workspaceSlug={slug}
      workspaceId={workspace.id}
      initialNotifications={notifications.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
      }))}
    />
  )
}
