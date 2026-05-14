/**
 * Server-side request-scoped cache helpers using React.cache().
 *
 * React.cache() deduplicates calls within the same server request/render tree.
 * This means layout.tsx and page.tsx calling getCachedUser() will only make
 * ONE remote Supabase auth call per page load instead of 2-3.
 *
 * These helpers are only valid in React Server Components (RSC).
 */
import { cache } from 'react'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

/**
 * Returns the authenticated Supabase user for the current request.
 * Deduplicates the remote auth.getUser() call — only one network round-trip
 * per request even if called from both layout and page.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

/**
 * Returns the workspace row for the given slug.
 * Deduplicates the DB lookup — if layout already fetched it, page gets the
 * cached result at zero cost.
 */
export const getCachedWorkspace = cache(async (slug: string) => {
  return prisma.workspace.findUnique({ where: { slug } })
})
