import { prisma } from '@/lib/prisma'
import { getCachedUser, getCachedWorkspace } from '@/lib/server-cache'
import { CostsContent } from './costs-content'

export default async function CostsPage({
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

  const membership = user && workspace
    ? await prisma.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: user.id },
        select: { role: true },
      })
    : null

  const isOwner = membership?.role === 'OWNER'

  return <CostsContent slug={slug} isOwner={isOwner} />
}
