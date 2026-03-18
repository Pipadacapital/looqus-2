import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { CalendarReportContent } from './calendar-report-content'

export default async function CalendarReportPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!workspace) redirect('/')

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  })
  if (!membership) redirect('/')

  return <CalendarReportContent workspaceSlug={slug} />
}
