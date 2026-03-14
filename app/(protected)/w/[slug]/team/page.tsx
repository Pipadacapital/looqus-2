import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getCachedUser, getCachedWorkspace } from '@/lib/server-cache'
import { TeamContent } from './team-content'

export default async function TeamPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // Layout already validated auth. Both getCachedUser and getCachedWorkspace
  // return cached results — no extra remote or DB calls.
  const [user, workspace] = await Promise.all([
    getCachedUser(),
    getCachedWorkspace(slug),
  ])

  if (!user || !workspace) redirect('/')

  // Fetch current membership, all members, and pending invitations in parallel.
  const [currentMembership, members, pendingInvitations] = await Promise.all([
    prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: workspace.id,
        },
      },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: workspace.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    }),
    prisma.invitation.findMany({
      where: {
        workspaceId: workspace.id,
        status: 'PENDING',
      },
      include: {
        invitedBy: {
          select: { fullName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  if (!currentMembership) redirect('/')

  const canManage = ['OWNER', 'ADMIN'].includes(currentMembership.role)

  return (
    <TeamContent
      workspaceId={workspace.id}
      workspaceSlug={slug}
      members={members.map((m) => ({
        id: m.id,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        user: {
          id: m.user.id,
          email: m.user.email,
          fullName: m.user.fullName,
          avatarUrl: m.user.avatarUrl,
        },
      }))}
      pendingInvitations={pendingInvitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        expiresAt: inv.expiresAt.toISOString(),
        invitedBy: inv.invitedBy.fullName ?? inv.invitedBy.email,
      }))}
      canManage={canManage}
      currentUserId={user.id}
    />
  )
}
