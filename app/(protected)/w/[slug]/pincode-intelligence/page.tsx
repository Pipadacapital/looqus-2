import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { format, subDays } from 'date-fns'
import { PincodeIntelligenceContent } from './pincode-intelligence-content'

export default async function PincodeIntelligencePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true, name: true },
  })

  if (!workspace) redirect('/')

  const today = format(new Date(), 'yyyy-MM-dd')
  const defaultFrom = format(subDays(new Date(), 89), 'yyyy-MM-dd')
  const initialFrom = typeof sp.from === 'string' ? sp.from : defaultFrom
  const initialTo = typeof sp.to === 'string' ? sp.to : today

  return (
    <PincodeIntelligenceContent
      workspaceSlug={slug}
      workspaceName={workspace.name}
      initialFrom={initialFrom}
      initialTo={initialTo}
    />
  )
}
