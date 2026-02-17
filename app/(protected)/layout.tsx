import { redirect } from 'next/navigation'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import React from 'react'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
  })

  if (!membership) {
    redirect('/onboarding')
  }

  return <>{children}</>
}
