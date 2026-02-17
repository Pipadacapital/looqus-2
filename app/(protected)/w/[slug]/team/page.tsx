import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { TeamContent } from './team-content'

export default async function TeamPage({
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
  })

  if (!workspace) redirect('/')

  const currentMembership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })

  if (!currentMembership) redirect('/')

  const members = await prisma.workspaceMember.findMany({
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
  })

  const pendingInvitations = await prisma.invitation.findMany({
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
  })

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
