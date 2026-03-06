import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { AdsBackfillClient } from './ads-backfill-client'

export default async function AdsBackfillPage({
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
    select: { id: true, name: true },
  })
  if (!workspace) redirect('/')

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
    select: { role: true },
  })
  if (!membership) redirect('/')

  const isOwner = membership.role === 'OWNER'

  return (
    <div className="max-w-2xl space-y-6 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ads Backfill</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {workspace.name} — Backfill Meta + Google Ads daily metrics (last 2 years).
        </p>
      </div>
      <AdsBackfillClient
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        isOwner={isOwner}
      />
    </div>
  )
}
