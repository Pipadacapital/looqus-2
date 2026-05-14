import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getCachedUser, getCachedWorkspace } from '@/lib/server-cache'
import { NotificationsContent } from './notifications-content'

export async function NotificationsLoader({ slug }: { slug: string }) {
  const [user, workspace] = await Promise.all([
    getCachedUser(),
    getCachedWorkspace(slug),
  ])

  if (!user || !workspace) redirect('/')

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
      initialNotifications={notifications.map((n: typeof notifications[number]) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
      }))}
    />
  )
}
