export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { loginShiprocket } from '@/lib/integrations/shiprocket'

export async function POST(request: NextRequest) {
  let body: { workspaceId: string; email: string; password: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { workspaceId, email, password } = body
  if (!workspaceId || !email || !password) {
    return NextResponse.json(
      { error: 'workspaceId, email, and password are required' },
      { status: 400 }
    )
  }

  const auth = await requireWorkspaceAdmin(workspaceId)
  if ('error' in auth) return auth.error

  try {
    const token = await loginShiprocket(email, password)

    await prisma.shiprocketConnection.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        email,
        password,
        accessToken: token,
        tokenObtainedAt: new Date(),
        status: 'CONNECTED',
      },
      update: {
        email,
        password,
        accessToken: token,
        tokenObtainedAt: new Date(),
        status: 'CONNECTED',
        lastSyncError: null,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Shiprocket login failed' },
      { status: 400 }
    )
  }
}
