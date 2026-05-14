import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const workspaceId = body.workspaceId as string | undefined

  await prisma.notification.updateMany({
    where: {
      userId: user.id,
      read: false,
      ...(workspaceId && { workspaceId }),
    },
    data: { read: true, readAt: new Date() },
  })

  return NextResponse.json({ success: true })
}
