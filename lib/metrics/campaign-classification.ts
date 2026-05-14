import type { PrismaClient } from '@prisma/client'
import type { AdPlatform, CampaignIntent, WorkspaceCampaignClassification } from './types'

const VALID_INTENTS = new Set<CampaignIntent>([
  'acquisition',
  'non_acquisition',
  'brand',
  'unclassified',
])

export function normalizeCampaignIntent(raw: string | null | undefined): CampaignIntent {
  if (raw && VALID_INTENTS.has(raw as CampaignIntent)) return raw as CampaignIntent
  return 'unclassified'
}

export type ClassificationKey = `${AdPlatform}:${string}`

export function classificationKey(platform: AdPlatform, campaignId: string): ClassificationKey {
  return `${platform}:${campaignId}`
}

/** Map key -> intent for fast spend splitting. */
export async function loadCampaignIntentMap(
  prisma: PrismaClient,
  workspaceId: string
): Promise<Map<ClassificationKey, CampaignIntent>> {
  const rows = await prisma.workspaceAdCampaignClassification.findMany({
    where: { workspaceId },
    select: { platform: true, campaignId: true, intent: true },
  })
  const map = new Map<ClassificationKey, CampaignIntent>()
  for (const r of rows) {
    const p = r.platform === 'google' ? 'google' : 'meta'
    map.set(classificationKey(p, r.campaignId), normalizeCampaignIntent(r.intent))
  }
  return map
}

export function resolveCampaignIntent(
  map: Map<ClassificationKey, CampaignIntent>,
  platform: AdPlatform,
  campaignId: string
): CampaignIntent {
  return map.get(classificationKey(platform, campaignId)) ?? 'unclassified'
}

export async function upsertWorkspaceCampaignClassification(
  prisma: PrismaClient,
  args: {
    workspaceId: string
    platform: AdPlatform
    campaignId: string
    intent: CampaignIntent
    campaignName?: string | null
  }
): Promise<WorkspaceCampaignClassification> {
  const intent = normalizeCampaignIntent(args.intent)
  const row = await prisma.workspaceAdCampaignClassification.upsert({
    where: {
      workspaceId_platform_campaignId: {
        workspaceId: args.workspaceId,
        platform: args.platform,
        campaignId: args.campaignId,
      },
    },
    create: {
      workspaceId: args.workspaceId,
      platform: args.platform,
      campaignId: args.campaignId,
      intent,
      campaignName: args.campaignName ?? null,
    },
    update: {
      intent,
      ...(args.campaignName !== undefined ? { campaignName: args.campaignName } : {}),
    },
  })
  return {
    workspaceId: row.workspaceId,
    platform: row.platform as AdPlatform,
    campaignId: row.campaignId,
    intent: normalizeCampaignIntent(row.intent),
    campaignName: row.campaignName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function listWorkspaceCampaignClassifications(
  prisma: PrismaClient,
  workspaceId: string
): Promise<WorkspaceCampaignClassification[]> {
  const rows = await prisma.workspaceAdCampaignClassification.findMany({
    where: { workspaceId },
    orderBy: [{ platform: 'asc' }, { campaignId: 'asc' }],
  })
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    platform: row.platform as AdPlatform,
    campaignId: row.campaignId,
    intent: normalizeCampaignIntent(row.intent),
    campaignName: row.campaignName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}
