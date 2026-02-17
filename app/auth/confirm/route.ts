import { type EmailOtpType } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { type NextRequest } from 'next/server'

import { createClient } from '@/lib/server'
import { ensureUserExists } from '@/lib/ensure-user'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const _next = searchParams.get('next')
  const next = _next?.startsWith('/') ? _next : null

  if (token_hash && type) {
    const supabase = await createClient()

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    })
    if (!error) {
      const dbUser = await ensureUserExists(supabase)

      if (next) {
        redirect(next)
      }

      if (dbUser) {
        const membership = await prisma.workspaceMember.findFirst({
          where: { userId: dbUser.id },
          include: { workspace: { select: { slug: true } } },
        })

        if (membership) {
          redirect(`/w/${membership.workspace.slug}/dashboard`)
        }
      }

      redirect('/onboarding')
    } else {
      redirect(`/auth/error?error=${error?.message}`)
    }
  }

  redirect(`/auth/error?error=No token hash or type`)
}
