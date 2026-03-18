import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { subDays, format, endOfDay } from 'date-fns'
import {
  fetchCampaignsWithSpendInRange,
  listWorkspaceCampaignClassifications,
  normalizeCampaignIntent,
  upsertWorkspaceCampaignClassification,
  type AdPlatform,
  type CampaignIntent,
} from '@/lib/metrics'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      meta_ads_connections: {
        select: {
          id: true,
          selected_ad_account_ids: true,
          selected_ad_account_id: true,
        },
      },
      google_ads_connections: {
        select: {
          id: true,
          selected_customer_ids: true,
          selected_customer_id: true,
        },
      },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = new Date()
  const toStr = toParam ?? format(endOfDay(now), 'yyyy-MM-dd')
  const fromStr = fromParam ?? format(subDays(now, 89), 'yyyy-MM-dd')
  const fromDate = new Date(fromStr + 'T00:00:00.000Z')
  const toDate = new Date(toStr + 'T23:59:59.999Z')
  if (Number.isNaN(fromDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  const [campaigns, saved] = await Promise.all([
    fetchCampaignsWithSpendInRange(prisma, workspace, fromDate, toDate),
    listWorkspaceCampaignClassifications(prisma, workspace.id),
  ])
  const savedMap = new Map(
    saved.map((s) => [`${s.platform}:${s.campaignId}`, s.intent] as const)
  )

  const spendByIntent: Record<CampaignIntent, number> = {
    acquisition: 0,
    non_acquisition: 0,
    brand: 0,
    unclassified: 0,
  }
  const campaignCountByIntent: Record<CampaignIntent, number> = {
    acquisition: 0,
    non_acquisition: 0,
    brand: 0,
    unclassified: 0,
  }
  let totalSpend = 0
  for (const c of campaigns) {
    totalSpend += c.spend
    const intent =
      (savedMap.get(`${c.platform}:${c.campaignId}`) as CampaignIntent) ?? 'unclassified'
    spendByIntent[intent] += c.spend
    campaignCountByIntent[intent] += 1
  }
  const sumIntentSpend =
    spendByIntent.acquisition +
    spendByIntent.non_acquisition +
    spendByIntent.brand +
    spendByIntent.unclassified
  const spendReconciles = Math.abs(sumIntentSpend - totalSpend) <= 0.02

  return NextResponse.json({
    from: fromStr,
    to: toStr,
    intentSummary: {
      totalSpend,
      spendByIntent,
      campaignCountByIntent,
      pctUnclassified:
        totalSpend > 0
          ? Math.round((spendByIntent.unclassified / totalSpend) * 10000) / 100
          : 0,
      spendReconciles,
    },
    campaigns: campaigns.map((c) => ({
      platform: c.platform,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      spend: c.spend,
      intent: (savedMap.get(`${c.platform}:${c.campaignId}`) as CampaignIntent) ?? 'unclassified',
    })),
  })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
  })
  if (!membership || membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { platform?: string; campaignId?: string; intent?: string; campaignName?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const platform = body.platform === 'google' ? 'google' : body.platform === 'meta' ? 'meta' : null
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : null
  if (!platform || !campaignId) {
    return NextResponse.json({ error: 'platform and campaignId required' }, { status: 400 })
  }

  const intent = normalizeCampaignIntent(body.intent)
  const row = await upsertWorkspaceCampaignClassification(prisma, {
    workspaceId: workspace.id,
    platform: platform as AdPlatform,
    campaignId,
    intent: intent as CampaignIntent,
    campaignName: body.campaignName ?? undefined,
  })

  return NextResponse.json({
    platform: row.platform,
    campaignId: row.campaignId,
    intent: row.intent,
    campaignName: row.campaignName,
  })
}
