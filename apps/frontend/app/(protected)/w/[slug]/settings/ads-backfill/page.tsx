import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getCachedUser, getCachedWorkspace } from '@/lib/server-cache'
import { AdsBackfillClient } from './ads-backfill-client'

export default async function AdsBackfillPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // Both return cached results from layout — no extra remote or DB calls.
  const [user, workspace] = await Promise.all([
    getCachedUser(),
    getCachedWorkspace(slug),
  ])

  if (!user || !workspace) redirect('/')

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
    select: { role: true },
  })

  if (!membership) redirect('/')

  const isOwner = membership.role === 'OWNER'

  return (
    <div className="max-w-2xl space-y-8 py-4 md:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Backfill</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {workspace.name} — Backfill historical data for ads and P&L.
        </p>
      </div>
      <AdsBackfillClient
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        workspaceSlug={slug}
        isOwner={isOwner}
      />
    </div>
  )
}
