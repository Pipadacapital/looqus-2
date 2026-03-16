import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { AccountContent } from './account-content'
import Loading from './loading'

export const metadata = {
  title: 'Account Settings',
}

async function AccountLoader() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      fullName: true,
      email: true,
      jobRole: true,
      avatarUrl: true,
      createdAt: true,
    },
  })

  if (!dbUser) redirect('/auth/login')

  // Find most recent workspace slug for back navigation
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    orderBy: { joinedAt: 'asc' },
    select: { workspace: { select: { slug: true } } },
  })

  const hasPassword = user.app_metadata?.providers?.includes('email') ?? true
  const isGoogleAuth = user.app_metadata?.providers?.includes('google') ?? false

  return (
    <AccountContent
      user={{
        id: dbUser.id,
        email: dbUser.email,
        fullName: dbUser.fullName ?? '',
        jobRole: dbUser.jobRole ?? '',
        avatarUrl: dbUser.avatarUrl ?? null,
        createdAt: dbUser.createdAt.toISOString(),
      }}
      hasPassword={hasPassword}
      isGoogleAuth={isGoogleAuth}
      backSlug={membership?.workspace.slug ?? null}
    />
  )
}

export default function AccountPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AccountLoader />
    </Suspense>
  )
}
