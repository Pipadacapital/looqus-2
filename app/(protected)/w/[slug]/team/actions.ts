'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail/send'
import { InviteMemberEmail } from '@/lib/mail/templates/invite-member'
import { createNotification } from '@/lib/notifications/create'

async function getAuthUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

async function assertRole(
  userId: string,
  workspaceId: string,
  allowedRoles: string[]
) {
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  })
  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new Error('You do not have permission to perform this action.')
  }
  return membership
}

// ─── Invite member ───────────────────────────────────────────────────────────

export async function inviteMember(data: {
  workspaceId: string
  workspaceSlug: string
  email: string
  role: string
}) {
  const user = await getAuthUser()
  if (!user) throw new Error('Not authenticated')

  await assertRole(user.id, data.workspaceId, ['OWNER', 'ADMIN'])

  const email = data.email.trim().toLowerCase()

  if (email === user.email?.toLowerCase()) {
    return { error: 'You cannot invite yourself.' }
  }

  const existingInvite = await prisma.invitation.findFirst({
    where: {
      email,
      workspaceId: data.workspaceId,
      status: 'PENDING',
    },
  })

  if (existingInvite) {
    return { error: 'An invitation is already pending for this email.' }
  }

  const existingMember = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: data.workspaceId,
      user: { email },
    },
  })

  if (existingMember) {
    return { error: 'This user is already a member of this workspace.' }
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: data.workspaceId },
    select: { name: true },
  })

  const invitation = await prisma.invitation.create({
    data: {
      email,
      workspaceId: data.workspaceId,
      role: data.role as 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER',
      invitedById: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  })

  const inviterName =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    user.email ??
    'Someone'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const acceptUrl = `${baseUrl}/invite/${invitation.token}`

  const roleLabel = data.role.charAt(0) + data.role.slice(1).toLowerCase()

  try {
    await sendMail({
      to: email,
      subject: `${inviterName} invited you to ${workspace?.name ?? 'a workspace'} on Shopify Analytics`,
      template: InviteMemberEmail({
        workspaceName: workspace?.name ?? 'Workspace',
        inviterName,
        inviteeEmail: email,
        role: roleLabel,
        acceptUrl,
      }),
    })
  } catch (err) {
    console.error('Failed to send invite email:', err)
  }

  const inviteeUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })

  if (inviteeUser) {
    await createNotification({
      userId: inviteeUser.id,
      workspaceId: data.workspaceId,
      type: 'WORKSPACE_INVITE',
      title: `${inviterName} invited you to ${workspace?.name ?? 'a workspace'}`,
      body: `You've been invited as ${roleLabel}. Click to accept.`,
      actionUrl: acceptUrl,
    }).catch(() => {})
  }

  revalidatePath(`/w/${data.workspaceSlug}/team`)
  return { success: true }
}

// ─── Update member role ──────────────────────────────────────────────────────

export async function updateMemberRole(data: {
  memberId: string
  workspaceId: string
  workspaceSlug: string
  newRole: string
}) {
  const user = await getAuthUser()
  if (!user) throw new Error('Not authenticated')

  await assertRole(user.id, data.workspaceId, ['OWNER', 'ADMIN'])

  const target = await prisma.workspaceMember.findUnique({
    where: { id: data.memberId },
  })

  if (!target || target.workspaceId !== data.workspaceId) {
    return { error: 'Member not found.' }
  }

  if (target.userId === user.id) {
    return { error: 'You cannot change your own role.' }
  }

  if (target.role === 'OWNER') {
    return { error: 'Cannot change the role of the workspace owner.' }
  }

  await prisma.workspaceMember.update({
    where: { id: data.memberId },
    data: {
      role: data.newRole as 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER',
    },
  })

  const workspace = await prisma.workspace.findUnique({
    where: { id: data.workspaceId },
    select: { name: true },
  })

  const newRoleLabel = data.newRole.charAt(0) + data.newRole.slice(1).toLowerCase()

  await createNotification({
    userId: target.userId,
    workspaceId: data.workspaceId,
    type: 'ROLE_CHANGED',
    title: `Your role was changed to ${newRoleLabel}`,
    body: `Your role in ${workspace?.name ?? 'the workspace'} has been updated.`,
    actionUrl: `/w/${data.workspaceSlug}/team`,
  }).catch(() => {})

  revalidatePath(`/w/${data.workspaceSlug}/team`)
  return { success: true }
}

// ─── Remove member ───────────────────────────────────────────────────────────

export async function removeMember(data: {
  memberId: string
  workspaceId: string
  workspaceSlug: string
}) {
  const user = await getAuthUser()
  if (!user) throw new Error('Not authenticated')

  await assertRole(user.id, data.workspaceId, ['OWNER', 'ADMIN'])

  const target = await prisma.workspaceMember.findUnique({
    where: { id: data.memberId },
  })

  if (!target || target.workspaceId !== data.workspaceId) {
    return { error: 'Member not found.' }
  }

  if (target.userId === user.id) {
    return { error: 'You cannot remove yourself from the workspace.' }
  }

  if (target.role === 'OWNER') {
    return { error: 'Cannot remove the workspace owner.' }
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: data.workspaceId },
    select: { name: true },
  })

  await prisma.workspaceMember.delete({
    where: { id: data.memberId },
  })

  await createNotification({
    userId: target.userId,
    workspaceId: data.workspaceId,
    type: 'MEMBER_REMOVED',
    title: `You were removed from ${workspace?.name ?? 'a workspace'}`,
    body: 'You no longer have access to this workspace.',
  }).catch(() => {})

  revalidatePath(`/w/${data.workspaceSlug}/team`)
  return { success: true }
}

// ─── Revoke invitation ───────────────────────────────────────────────────────

export async function revokeInvitation(data: {
  invitationId: string
  workspaceId: string
  workspaceSlug: string
}) {
  const user = await getAuthUser()
  if (!user) throw new Error('Not authenticated')

  await assertRole(user.id, data.workspaceId, ['OWNER', 'ADMIN'])

  const invitation = await prisma.invitation.findUnique({
    where: { id: data.invitationId },
  })

  if (!invitation || invitation.workspaceId !== data.workspaceId) {
    return { error: 'Invitation not found.' }
  }

  if (invitation.status !== 'PENDING') {
    return { error: 'Only pending invitations can be revoked.' }
  }

  await prisma.invitation.update({
    where: { id: data.invitationId },
    data: { status: 'REVOKED' },
  })

  revalidatePath(`/w/${data.workspaceSlug}/team`)
  return { success: true }
}
