import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { LogisticsContent } from './logistics-content'

export default async function LogisticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
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

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: workspace.id, userId: user.id },
    select: { role: true },
  })

  if (!membership) redirect('/')

  const today = new Date()
  const defaultTo = today.toISOString().slice(0, 10)
  const defaultFrom = new Date(today)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 89)
  const defaultFromStr = defaultFrom.toISOString().slice(0, 10)

  const from =
    typeof sp.from === 'string' && sp.from.trim() !== '' ? sp.from : defaultFromStr
  const to = typeof sp.to === 'string' && sp.to.trim() !== '' ? sp.to : defaultTo

  return (
    <LogisticsContent
      slug={slug}
      workspaceName={workspace.name}
      initialFrom={from}
      initialTo={to}
    />
  )
}
