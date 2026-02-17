import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { ensureUserExists } from '@/lib/ensure-user'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: {
      workspace: { select: { slug: true, name: true } },
    },
  })

  if (!invitation) {
    return NextResponse.redirect(
      new URL('/auth/error?error=Invalid invitation link', request.url)
    )
  }

  if (invitation.status !== 'PENDING') {
    return NextResponse.redirect(
      new URL(
        `/auth/error?error=This invitation has already been ${invitation.status.toLowerCase()}`,
        request.url
      )
    )
  }

  if (new Date() > invitation.expiresAt) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'EXPIRED' },
    })
    return NextResponse.redirect(
      new URL('/auth/error?error=This invitation has expired', request.url)
    )
  }

  // Check if user is authenticated
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // Not logged in — redirect to login, then come back
    const callbackUrl = `/invite/${token}`
    return NextResponse.redirect(
      new URL(`/auth/login?next=${encodeURIComponent(callbackUrl)}`, request.url)
    )
  }

  // Ensure user exists in our DB
  await ensureUserExists(supabase)

  // Check if already a member
  const existingMember = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: invitation.workspaceId,
      },
    },
  })

  if (existingMember) {
    // Already a member — mark invite accepted, redirect to workspace
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED' },
    })
    return NextResponse.redirect(
      new URL(`/w/${invitation.workspace.slug}/dashboard`, request.url)
    )
  }

  // Accept invitation: create membership + update status
  await prisma.$transaction([
    prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: invitation.workspaceId,
        role: invitation.role,
      },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED' },
    }),
  ])

  return NextResponse.redirect(
    new URL(`/w/${invitation.workspace.slug}/dashboard`, request.url)
  )
}
