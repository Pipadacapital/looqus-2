import { prisma } from '@/lib/prisma'
import { fetchAdAccountInsights, type MetaInsightRow } from './meta'
import { Decimal } from '@prisma/client/runtime/library'

export async function syncMetaAdsForConnection(connectionId: string, days = 30) {
  const connection = await prisma.metaAdsConnection.findUnique({
    where: { id: connectionId },
  })

  if (!connection || connection.status !== 'CONNECTED') return

  // Determine which account to sync
  let targetAccount = connection.selectedAdAccountId
  if (!targetAccount && connection.adAccountIds.length === 1) {
    targetAccount = connection.adAccountIds[0]
    await prisma.metaAdsConnection.update({
      where: { id: connection.id },
      data: { selectedAdAccountId: targetAccount },
    })
  }
  if (!targetAccount) {
    await prisma.metaAdsConnection.update({
      where: { id: connection.id },
      data: { lastSyncError: 'Multiple ad accounts available — please select one before syncing.' },
    })
    return
  }

  const until = new Date()
  const since = new Date()
  since.setDate(since.getDate() - days)

  const sinceStr = since.toISOString().slice(0, 10)
  const untilStr = until.toISOString().slice(0, 10)

  const errors: string[] = []

  for (const adAccountId of [targetAccount]) {
    try {
      const rows: MetaInsightRow[] = await fetchAdAccountInsights(
        connection.accessToken,
        adAccountId,
        sinceStr,
        untilStr
      )

      for (const row of rows) {
        await prisma.metaAdsDailyMetric.upsert({
          where: {
            connectionId_adAccountId_campaignId_date: {
              connectionId: connection.id,
              adAccountId,
              campaignId: row.campaignId,
              date: new Date(row.date),
            },
          },
          create: {
            connectionId: connection.id,
            adAccountId,
            campaignId: row.campaignId,
            campaignName: row.campaignName,
            adsetId: row.adsetId,
            adsetName: row.adsetName,
            date: new Date(row.date),
            impressions: row.impressions,
            clicks: row.clicks,
            spend: new Decimal(row.spend),
            conversions: row.conversions,
            revenue: new Decimal(row.revenue),
            ctr: new Decimal(row.ctr),
            cpc: new Decimal(row.cpc),
            cpm: new Decimal(row.cpm),
            rawJson: row.rawJson as object,
          },
          update: {
            campaignName: row.campaignName,
            adsetId: row.adsetId,
            adsetName: row.adsetName,
            impressions: row.impressions,
            clicks: row.clicks,
            spend: new Decimal(row.spend),
            conversions: row.conversions,
            revenue: new Decimal(row.revenue),
            ctr: new Decimal(row.ctr),
            cpc: new Decimal(row.cpc),
            cpm: new Decimal(row.cpm),
            rawJson: row.rawJson as object,
          },
        })
      }
    } catch (err) {
      errors.push(`${adAccountId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  await prisma.metaAdsConnection.update({
    where: { id: connection.id },
    data: {
      lastSyncAt: new Date(),
      lastSyncError: errors.length > 0 ? errors.join('; ') : null,
    },
  })
}

export async function syncAllMetaAds(days = 30) {
  const connections = await prisma.metaAdsConnection.findMany({
    where: { status: 'CONNECTED' },
    select: { id: true },
  })

  for (const c of connections) {
    try {
      await syncMetaAdsForConnection(c.id, days)
    } catch (err) {
      console.error(`Meta sync failed for connection ${c.id}:`, err)
    }
  }
}
