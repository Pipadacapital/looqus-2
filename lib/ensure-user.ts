import { prisma } from '@/lib/prisma'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Ensures a corresponding row exists in the public `users` table
 * for the currently authenticated Supabase user.
 * Uses upsert so it's safe to call on every login (idempotent).
 */
export async function ensureUserExists(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const email = user.email
  const fullName =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    null
  const avatarUrl =
    user.user_metadata?.avatar_url ??
    user.user_metadata?.picture ??
    null

  if (!email) return null

  const dbUser = await prisma.user.upsert({
    where: { id: user.id },
    update: {
      email,
      fullName,
      avatarUrl,
    },
    create: {
      id: user.id,
      email,
      fullName,
      avatarUrl,
    },
  })

  return dbUser
}
