import { NextResponse } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { fullName, jobRole } = body as { fullName?: string; jobRole?: string }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(fullName !== undefined && { fullName: fullName.trim() }),
      ...(jobRole !== undefined && { jobRole: jobRole.trim() || null }),
    },
  })

  // Sync display name into Supabase user metadata so the sidebar reflects it
  if (fullName !== undefined) {
    await supabase.auth.updateUser({
      data: { full_name: fullName.trim() },
    })
  }

  return NextResponse.json({ ok: true })
}
