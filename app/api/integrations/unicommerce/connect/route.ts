export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import {
  getUnicommerceToken,
  searchFacilities,
} from '@/lib/integrations/unicommerce'

export async function POST(request: NextRequest) {
  let body: {
    workspaceId: string
    tenant: string
    username: string
    password: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { workspaceId, tenant, username, password } = body
  if (!workspaceId || !tenant || !username || !password) {
    return NextResponse.json(
      { error: 'workspaceId, tenant, username, and password are required' },
      { status: 400 }
    )
  }

  const auth = await requireWorkspaceAdmin(workspaceId)
  if ('error' in auth) return auth.error

  try {
    const trimmedTenant = tenant.trim().toLowerCase()
    const { accessToken } = await getUnicommerceToken(
      trimmedTenant,
      username.trim(),
      password
    )
    let facilityCodes: string[] = []
    try {
      facilityCodes = await searchFacilities(trimmedTenant, accessToken)
    } catch {
      // Non-fatal; user can sync later.
    }

    await prisma.unicommerceConnection.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        tenant: trimmedTenant,
        username: username.trim(),
        password,
        accessToken,
        tokenObtainedAt: new Date(),
        status: 'CONNECTED',
        facilityCodes,
      },
      update: {
        tenant: trimmedTenant,
        username: username.trim(),
        password,
        accessToken,
        tokenObtainedAt: new Date(),
        status: 'CONNECTED',
        lastSyncError: null,
        facilityCodes,
      },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: 'Invalid Unicommerce credentials' },
      { status: 401 }
    )
  }
}
