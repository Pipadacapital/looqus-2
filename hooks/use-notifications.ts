'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/client'
import { toast } from 'sonner'
import type { NotificationType } from '@prisma/client'

export type NotificationItem = {
  id: string
  type: NotificationType
  title: string
  body: string | null
  actionUrl: string | null
  read: boolean
  metadata: unknown
  createdAt: string
  readAt: string | null
  workspaceId: string | null
}

export function useNotifications(workspaceId?: string) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const mountedRef = useRef(true)

  const qs = workspaceId
    ? `?workspaceId=${workspaceId}&limit=20`
    : '?limit=20'
  const unreadQs = workspaceId ? `?workspaceId=${workspaceId}` : ''

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications${qs}`)
      if (!res.ok) return
      const data = await res.json()
      if (mountedRef.current) setNotifications(data.items)
    } catch {
      // silently fail
    }
  }, [qs])

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications/unread-count${unreadQs}`)
      if (!res.ok) return
      const data = await res.json()
      if (mountedRef.current) setUnreadCount(data.count)
    } catch {
      // silently fail
    }
  }, [unreadQs])

  const markAsRead = useCallback(
    async (id: string) => {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n
        )
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))

      await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' })
    },
    []
  )

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() }))
    )
    setUnreadCount(0)

    await fetch('/api/notifications/read-all', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    })
  }, [workspaceId])

  useEffect(() => {
    mountedRef.current = true

    const init = async () => {
      await Promise.all([fetchNotifications(), fetchUnreadCount()])
      if (mountedRef.current) setIsLoading(false)
    }
    init()

    const supabase = createClient()

    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>

          const newNotif: NotificationItem = {
            id: row.id as string,
            type: row.type as NotificationType,
            title: row.title as string,
            body: (row.body as string) ?? null,
            actionUrl: (row.action_url as string) ?? null,
            read: false,
            metadata: row.metadata ?? null,
            createdAt: row.created_at as string,
            readAt: null,
            workspaceId: (row.workspace_id as string) ?? null,
          }

          if (workspaceId && newNotif.workspaceId && newNotif.workspaceId !== workspaceId) {
            return
          }

          setNotifications((prev) => [newNotif, ...prev])
          setUnreadCount((prev) => prev + 1)
          toast(newNotif.title, {
            description: newNotif.body ?? undefined,
          })
        }
      )
      .subscribe()

    return () => {
      mountedRef.current = false
      supabase.removeChannel(channel)
    }
  }, [fetchNotifications, fetchUnreadCount, workspaceId])

  return {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    refetch: () => Promise.all([fetchNotifications(), fetchUnreadCount()]),
  }
}
