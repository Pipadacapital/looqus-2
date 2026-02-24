import { prisma } from '@/lib/prisma'
import type { NotificationType, Notification } from '@prisma/client'

type CreateNotificationParams = {
  userId: string
  workspaceId?: string
  type: NotificationType
  title: string
  body?: string
  actionUrl?: string
  metadata?: Record<string, unknown>
}

export async function createNotification(
  params: CreateNotificationParams
): Promise<Notification> {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      workspaceId: params.workspaceId,
      type: params.type,
      title: params.title,
      body: params.body,
      actionUrl: params.actionUrl,
      metadata: params.metadata as any | null,
    },
  })
}

export async function createNotificationForMany(
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>
): Promise<number> {
  if (userIds.length === 0) return 0

  const result = await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      workspace_id: params.workspaceId,
      type: params.type,
      title: params.title,
      body: params.body,
      action_url: params.actionUrl,
      metadata: params.metadata as any | null,
    })),
  })

  return result.count
}
