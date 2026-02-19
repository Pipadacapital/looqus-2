import { prisma } from '@/lib/prisma'
import {
  refreshGoogleAccessToken,
  executeGaql,
  type GoogleAdsMetricRow,
} from './google'
import { Decimal } from '@prisma/client/runtime/library'

export async function syncGoogleAdsForConnection(connectionId: string, days = 30) {
  const connection = await prisma.googleAdsConnection.findUnique({
    where: { id: connectionId },
  })

  if (!connection || connection.status !== 'CONNECTED') return

  // Determine which customer to sync
  let targetCustomer = connection.selectedCustomerId
  if (!targetCustomer && connection.customerIds.length === 1) {
    targetCustomer = connection.customerIds[0]
    await prisma.googleAdsConnection.update({
      where: { id: connection.id },
      data: { selectedCustomerId: targetCustomer },
    })
  }
  if (!targetCustomer) {
    await prisma.googleAdsConnection.update({
      where: { id: connection.id },
      data: { lastSyncError: 'Multiple customer IDs available — please select one before syncing.' },
    })
    return
  }

  const { accessToken } = await refreshGoogleAccessToken(connection.refreshToken)

  const until = new Date()
  const since = new Date()
  since.setDate(since.getDate() - days)

  const sinceStr = since.toISOString().slice(0, 10)
  const untilStr = until.toISOString().slice(0, 10)

  const errors: string[] = []

  for (const customerId of [targetCustomer]) {
    try {
      const query = `
        SELECT
          campaign.id,
          campaign.name,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc
        FROM campaign
        WHERE segments.date BETWEEN '${sinceStr}' AND '${untilStr}'
          AND campaign.status != 'REMOVED'
        ORDER BY segments.date DESC
      `

      const results = await executeGaql(accessToken, customerId, query)

      for (const row of results as GoogleGaqlRow[]) {
        const campaign = row.campaign
        const metrics = row.metrics
        const date = row.segments?.date

        if (!campaign?.id || !date) continue

        const parsed: GoogleAdsMetricRow = {
          customerId,
          campaignId: String(campaign.id),
          campaignName: campaign.name || '',
          adGroupId: null,
          adGroupName: null,
          date,
          impressions: parseInt(metrics?.impressions || '0', 10),
          clicks: parseInt(metrics?.clicks || '0', 10),
          spend: (parseInt(metrics?.costMicros || '0', 10)) / 1_000_000,
          conversions: parseFloat(metrics?.conversions || '0'),
          conversionValue: parseFloat(metrics?.conversionsValue || '0'),
          ctr: parseFloat(metrics?.ctr || '0'),
          averageCpc: (parseInt(metrics?.averageCpc || '0', 10)) / 1_000_000,
          rawJson: row,
        }

        await prisma.googleAdsDailyMetric.upsert({
          where: {
            connectionId_customerId_campaignId_date: {
              connectionId: connection.id,
              customerId,
              campaignId: parsed.campaignId,
              date: new Date(parsed.date),
            },
          },
          create: {
            connectionId: connection.id,
            customerId,
            campaignId: parsed.campaignId,
            campaignName: parsed.campaignName,
            date: new Date(parsed.date),
            impressions: parsed.impressions,
            clicks: parsed.clicks,
            spend: new Decimal(parsed.spend),
            conversions: new Decimal(parsed.conversions),
            conversionValue: new Decimal(parsed.conversionValue),
            ctr: new Decimal(parsed.ctr),
            averageCpc: new Decimal(parsed.averageCpc),
            rawJson: parsed.rawJson as object,
          },
          update: {
            campaignName: parsed.campaignName,
            impressions: parsed.impressions,
            clicks: parsed.clicks,
            spend: new Decimal(parsed.spend),
            conversions: new Decimal(parsed.conversions),
            conversionValue: new Decimal(parsed.conversionValue),
            ctr: new Decimal(parsed.ctr),
            averageCpc: new Decimal(parsed.averageCpc),
            rawJson: parsed.rawJson as object,
          },
        })
      }
    } catch (err) {
      errors.push(`${customerId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  await prisma.googleAdsConnection.update({
    where: { id: connection.id },
    data: {
      lastSyncAt: new Date(),
      lastSyncError: errors.length > 0 ? errors.join('; ') : null,
    },
  })
}

type GoogleGaqlRow = {
  campaign?: { id?: string; name?: string }
  metrics?: {
    impressions?: string
    clicks?: string
    costMicros?: string
    conversions?: string
    conversionsValue?: string
    ctr?: string
    averageCpc?: string
  }
  segments?: { date?: string }
}

export async function syncAllGoogleAds(days = 30) {
  const connections = await prisma.googleAdsConnection.findMany({
    where: { status: 'CONNECTED' },
    select: { id: true },
  })

  for (const c of connections) {
    try {
      await syncGoogleAdsForConnection(c.id, days)
    } catch (err) {
      console.error(`Google Ads sync failed for connection ${c.id}:`, err)
    }
  }
}
