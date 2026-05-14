import { NextResponse } from 'next/server'
import { createClient } from '@/lib/server'
import { getCachedUser } from '@/lib/server-cache'
import { prisma } from '@/lib/prisma'

type DbUser = { id: string; email: string; systemRole: string }

/**
 * Requires the current user to be authenticated and have systemRole SUPERADMIN.
 * Use in API routes and server components/layouts for admin-only access.
 */
export async function requireSuperadmin(): Promise<
  | { user: { id: string; email: string }; dbUser: DbUser }
  | { error: NextResponse }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, systemRole: true },
  })

  if (!dbUser || dbUser.systemRole !== 'SUPERADMIN') {
    return { error: NextResponse.json({ error: 'Forbidden. Superadmin only.' }, { status: 403 }) }
  }

  return {
    user: { id: user.id, email: user.email ?? '' },
    dbUser: dbUser as DbUser,
  }
}

/**
 * Returns the current user's DB record with systemRole, or null if not found.
 * Use in server components to conditionally show admin UI (e.g. link to /admin).
 */
export async function getCurrentUserRole(): Promise<'SUPERADMIN' | 'USER' | null> {
  // Use cached user — no extra remote auth call when layout already called getCachedUser().
  const user = await getCachedUser()
  if (!user) return null

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { systemRole: true },
  })
  return dbUser?.systemRole ?? null
}
