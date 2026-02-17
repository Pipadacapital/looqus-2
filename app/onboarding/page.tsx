import { redirect } from 'next/navigation'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { OnboardingForm } from './onboarding-form'

export default async function OnboardingPage() {
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

  if (membership) {
    redirect('/dashboard')
  }

  const fullName =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    ''
  const email = user.email ?? ''

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to Shopify Analytics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Let&apos;s get you set up in a few quick steps.
          </p>
        </div>

        <OnboardingForm defaultFullName={fullName} email={email} />
      </div>
    </div>
  )
}
