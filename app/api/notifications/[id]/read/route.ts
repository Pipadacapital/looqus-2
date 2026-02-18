import { NextResponse } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const notification = await prisma.notification.findUnique({
    where: { id },
    select: { userId: true },
  })

  if (!notification || notification.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.notification.update({
    where: { id },
    data: { read: true, readAt: new Date() },
  })

  return NextResponse.json({ success: true })
}
