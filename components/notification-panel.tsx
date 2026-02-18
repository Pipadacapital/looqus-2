'use client'

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
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useNotifications, type NotificationItem } from '@/hooks/use-notifications'
import { useWorkspace } from '@/hooks/use-workspace'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

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

function NotificationIcon({ type }: { type: string }) {
  const Icon = TYPE_ICONS[type] ?? IconBell
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
      <Icon className="h-4 w-4 text-muted-foreground" />
    </div>
  )
}

function NotificationRow({
  notification,
  onRead,
}: {
  notification: NotificationItem
  onRead: (id: string) => void
}) {
  const router = useRouter()

  const handleClick = () => {
    if (!notification.read) onRead(notification.id)
    if (notification.actionUrl) router.push(notification.actionUrl)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50',
        !notification.read && 'bg-primary/[0.03]'
      )}
    >
      <NotificationIcon type={notification.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm leading-snug',
              !notification.read ? 'font-medium' : 'text-muted-foreground'
            )}
          >
            {notification.title}
          </p>
          {!notification.read && (
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
          )}
        </div>
        {notification.body && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {notification.body}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground/60">
          {formatDistanceToNow(new Date(notification.createdAt), {
            addSuffix: true,
          })}
        </p>
      </div>
    </button>
  )
}

export function NotificationPanel() {
  const { current } = useWorkspace()
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
  } = useNotifications(current.id)
  const router = useRouter()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <IconBell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs text-muted-foreground"
              onClick={markAllAsRead}
            >
              <IconChecks className="mr-1 h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <IconBell className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No notifications yet
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onRead={markAsRead}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {notifications.length > 0 && (
          <div className="border-t px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground"
              onClick={() =>
                router.push(`/w/${current.slug}/notifications`)
              }
            >
              View all notifications
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
