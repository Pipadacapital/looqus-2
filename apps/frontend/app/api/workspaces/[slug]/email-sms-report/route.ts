import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import {
  aggregateEmailPerformance,
  type EmailPerfGroupBy,
} from '@/lib/email-performance/compute'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const gb = (searchParams.get('groupBy') ?? 'campaign') as EmailPerfGroupBy
  const groupBy: EmailPerfGroupBy = ['campaign', 'flow', 'date', 'channel', 'dow'].includes(gb)
    ? gb
    : 'campaign'

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to required (yyyy-MM-dd)' }, { status: 400 })
  }

  const workspace = await prisma.workspace.findUnique({ where: { slug }, select: { id: true } })
  if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
  })
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await aggregateEmailPerformance(prisma, workspace.id, { from, to, groupBy })

  return NextResponse.json({
    rows,
    from,
    to,
    groupBy,
    formulas: {
      openRate: 'unique_opens / delivered',
      clickRate: 'unique_clicks / delivered',
      revenuePerRecipient: 'revenue / delivered',
      revenuePerUniqueOpen: 'revenue / unique_opens',
      unsubscribeRate: 'unsubscribes / delivered',
      spamRate: 'spam_complaints / delivered',
    },
  })
}
