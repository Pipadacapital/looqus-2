'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  IconBell,
  IconCheck,
  IconChecks,
  IconMail,
  IconUserPlus,
  IconUserMinus,
  IconSwitchHorizontal,
  IconPlugConnected,
  IconPlugConnectedX,
  IconRefresh,
  IconAlertTriangle,
  IconInfoCircle,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import type { NotificationItem } from '@/hooks/use-notifications'

const TYPE_ICONS: Record<string, typeof IconBell> = {
  WORKSPACE_INVITE: IconMail,
  INVITE_ACCEPTED: IconCheck,
  MEMBER_JOINED: IconUserPlus,
  MEMBER_REMOVED: IconUserMinus,
  ROLE_CHANGED: IconSwitchHorizontal,
  SHOPIFY_CONNECTED: IconPlugConnected,
  SHOPIFY_DISCONNECTED: IconPlugConnectedX,
  SYNC_COMPLETED: IconRefresh,
  SYNC_FAILED: IconAlertTriangle,
  SYSTEM: IconInfoCircle,
}

interface NotificationsContentProps {
  workspaceSlug: string
  workspaceId: string
  initialNotifications: NotificationItem[]
}

export function NotificationsContent({
  workspaceSlug,
  workspaceId,
  initialNotifications,
}: NotificationsContentProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState(initialNotifications)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [isPending, startTransition] = useTransition()

  const filtered =
    filter === 'unread'
      ? notifications.filter((n) => !n.read)
      : notifications

  const unreadCount = notifications.filter((n) => !n.read).length

  const handleMarkRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n
      )
    )
    fetch(`/api/notifications/${id}/read`, { method: 'PATCH' })
  }

  const handleMarkAllRead = () => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() }))
    )
    fetch('/api/notifications/read-all', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    })
  }

  const handleClick = (notification: NotificationItem) => {
    if (!notification.read) handleMarkRead(notification.id)
    if (notification.actionUrl) {
      startTransition(() => {
        router.push(notification.actionUrl!)
      })
    }
  }

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
              : 'You\'re all caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
            <IconChecks className="mr-1.5 h-4 w-4" />
            Mark all as read
          </Button>
        )}
      </div>

      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as 'all' | 'unread')}
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread
            {unreadCount > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                {unreadCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-xl border bg-card shadow-sm">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <IconBell className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {filter === 'unread'
                ? 'No unread notifications'
                : 'No notifications yet'}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((notification) => {
              const Icon = TYPE_ICONS[notification.type] ?? IconBell
              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleClick(notification)}
                  disabled={isPending}
                  className={cn(
                    'flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/50',
                    !notification.read && 'bg-primary/[0.03]'
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={cn(
                          'text-sm leading-snug',
                          !notification.read
                            ? 'font-medium'
                            : 'text-muted-foreground'
                        )}
                      >
                        {notification.title}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs text-muted-foreground/60">
                          {formatDistanceToNow(
                            new Date(notification.createdAt),
                            { addSuffix: true }
                          )}
                        </span>
                        {!notification.read && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                    </div>
                    {notification.body && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {notification.body}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
