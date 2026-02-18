import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const workspaceId = searchParams.get('workspaceId')
  const unreadOnly = searchParams.get('unreadOnly') === 'true'
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 50)
  const cursor = searchParams.get('cursor')

  const where: Parameters<typeof prisma.notification.findMany>[0]['where'] = {
    userId: user.id,
    ...(workspaceId && { workspaceId }),
    ...(unreadOnly && { read: false }),
  }

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1,
    }),
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

  const hasMore = notifications.length > limit
  const items = hasMore ? notifications.slice(0, limit) : notifications
  const nextCursor = hasMore ? items[items.length - 1].id : null

  return NextResponse.json({ items, nextCursor })
}
