import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/server'
import { NextResponse } from 'next/server'

/**
 * Verifies the current user is authenticated and is an OWNER or ADMIN
 * of the given workspace. Returns user + workspace or an error response.
 */
export async function requireWorkspaceAdmin(workspaceId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, slug: true },
  })

  if (!workspace) {
    return { error: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) }
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId },
    },
  })

  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    return {
      error: NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      ),
    }
  }

  return { user, workspace }
}
