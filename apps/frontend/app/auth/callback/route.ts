import { NextResponse, type NextRequest } from 'next/server'

import { createClient } from '@/lib/server'
import { ensureUserExists } from '@/lib/ensure-user'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')?.startsWith('/') ? searchParams.get('next')! : null

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const dbUser = await ensureUserExists(supabase)

      if (next) {
        return NextResponse.redirect(new URL(next, request.url))
      }

      if (dbUser) {
        const membership = await prisma.workspaceMember.findFirst({
          where: { userId: dbUser.id },
          include: { workspace: { select: { slug: true } } },
        })

        if (membership) {
          return NextResponse.redirect(
            new URL(`/w/${membership.workspace.slug}/dashboard`, request.url)
          )
        }

        return NextResponse.redirect(new URL('/onboarding', request.url))
      }

      return NextResponse.redirect(new URL('/onboarding', request.url))
    }
  }

  return NextResponse.redirect(new URL('/auth/error?error=Could not sign in with Google', request.url))
}
