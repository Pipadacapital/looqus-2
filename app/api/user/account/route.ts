import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

export async function DELETE() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Delete from Prisma first (cascades memberships, notifications, etc.)
  await prisma.user.delete({ where: { id: user.id } })

  // Delete from Supabase Auth using the admin client (service role)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceRoleKey) {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
    )
    await adminClient.auth.admin.deleteUser(user.id)
  } else {
    // Fallback: sign out the user so they can't do anything
    await supabase.auth.signOut()
  }

  return NextResponse.json({ ok: true })
}
