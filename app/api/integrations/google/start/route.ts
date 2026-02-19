export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { generateState, createOAuthState } from '@/lib/integrations/oauth-state'
import { buildGoogleAuthUrl } from '@/lib/integrations/google'

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })
  }

  const auth = await requireWorkspaceAdmin(workspaceId)
  if ('error' in auth) return auth.error

  const state = generateState()

  await createOAuthState({
    provider: 'GOOGLE',
    workspaceId,
    userId: auth.user.id,
    state,
  })

  const authUrl = buildGoogleAuthUrl(state)
  return NextResponse.redirect(authUrl)
}
