export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceAdmin } from '@/lib/integrations/helpers'
import { fetchWoocommerceCurrency, testWoocommerceConnection } from '@/lib/integrations/woocommerce'

export async function POST(request: NextRequest) {
  let body: {
    workspaceId: string
    storeUrl: string
    consumerKey: string
    consumerSecret: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { workspaceId, storeUrl, consumerKey, consumerSecret } = body
  if (!workspaceId || !storeUrl || !consumerKey || !consumerSecret) {
    return NextResponse.json(
      { error: 'workspaceId, storeUrl, consumerKey, and consumerSecret are required' },
      { status: 400 }
    )
  }

  const auth = await requireWorkspaceAdmin(workspaceId)
  if ('error' in auth) return auth.error

  const normalizedUrl = storeUrl.trim().replace(/\/+$/, '')

  const test = await testWoocommerceConnection(normalizedUrl, consumerKey, consumerSecret)
  if (!test.success) {
    return NextResponse.json(
      { error: test.error ?? 'Could not connect to WooCommerce store' },
      { status: 400 }
    )
  }

  const currency = await fetchWoocommerceCurrency(normalizedUrl, consumerKey, consumerSecret)

  await prisma.$transaction([
    prisma.woocommerceConnection.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        storeUrl: normalizedUrl,
        consumerKey,
        consumerSecret,
        currency,
        status: 'CONNECTED',
      },
      update: {
        storeUrl: normalizedUrl,
        consumerKey,
        consumerSecret,
        currency,
        status: 'CONNECTED',
        lastSyncError: null,
      },
    }),
    prisma.workspace.update({
      where: { id: workspaceId },
      data: { platform: 'WOOCOMMERCE' },
    }),
  ])

  return NextResponse.json({ success: true, storeName: test.storeName ?? null })
}
