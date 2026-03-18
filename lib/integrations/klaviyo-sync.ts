import { prisma } from '@/lib/prisma'
import { format, subDays } from 'date-fns'
import type { CampaignStats } from '@/lib/integrations/klaviyo-client'
import {
  klaviyoCampaignValuesForIds,
  klaviyoFindPlacedOrderMetricId,
  klaviyoFlowSeriesDaily,
  klaviyoListCampaignsSince,
} from '@/lib/integrations/klaviyo-client'

const BATCH = 6
const BATCH_DELAY_MS = 32000
const MAX_CAMPAIGN_BATCHES = 12

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function syncKlaviyoForWorkspace(workspaceId: string): Promise<{
  campaignsSynced: number
  flowDaysSynced: number
  error?: string
}> {
  const conn = await prisma.klaviyoConnection.findUnique({
    where: { workspaceId },
  })
  if (!conn) throw new Error('Klaviyo not connected')

  let conversionId = conn.conversionMetricId
  if (!conversionId) {
    conversionId = await klaviyoFindPlacedOrderMetricId(conn.apiKey)
    if (conversionId) {
      await prisma.klaviyoConnection.update({
        where: { id: conn.id },
        data: { conversionMetricId: conversionId },
      })
    }
  }
  if (!conversionId) {
    await prisma.klaviyoConnection.update({
      where: { id: conn.id },
      data: {
        lastSyncError:
          'Could not resolve Placed Order metric ID. Ensure API key has metrics:read and campaigns:read.',
        lastSyncAt: new Date(),
      },
    })
    throw new Error('Placed Order metric not found — check API key scopes')
  }

  const since = format(subDays(new Date(), 120), "yyyy-MM-dd'T'00:00:00Z")
  const campaigns = await klaviyoListCampaignsSince(conn.apiKey, since, 20)

  const statsByCampaign = new Map<string, CampaignStats>()
  const ids = campaigns.map((c) => c.id)
  for (let i = 0; i < ids.length && i / BATCH < MAX_CAMPAIGN_BATCHES; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    const m = await klaviyoCampaignValuesForIds(conn.apiKey, chunk, conversionId)
    for (const [k, v] of m) statsByCampaign.set(k, v)
    if (i + BATCH < ids.length) await sleep(BATCH_DELAY_MS)
  }

  const startD = format(subDays(new Date(), 90), 'yyyy-MM-dd')
  const endD = format(new Date(), 'yyyy-MM-dd')

  let flowPoints = await klaviyoFlowSeriesDaily(conn.apiKey, startD, endD, conversionId, 'email')
  await sleep(BATCH_DELAY_MS)
  try {
    const smsFlow = await klaviyoFlowSeriesDaily(conn.apiKey, startD, endD, conversionId, 'sms')
    flowPoints = flowPoints.concat(smsFlow)
  } catch {
    /* optional */
  }

  let campaignsSynced = 0
  for (const c of campaigns) {
    const st = statsByCampaign.get(c.id) ?? {
      delivered: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
      orders: 0,
      revenue: 0,
      unsubscribes: 0,
      spamComplaints: 0,
    }
    const sendDate = new Date((c.sendTime ?? '').slice(0, 10) + 'T12:00:00.000Z')
    if (Number.isNaN(sendDate.getTime())) continue
    await prisma.emailPerformance.upsert({
      where: {
        workspaceId_sourceType_klaviyoResourceId_sendDate: {
          workspaceId,
          sourceType: 'campaign',
          klaviyoResourceId: c.id,
          sendDate,
        },
      },
      create: {
        workspaceId,
        klaviyoConnectionId: conn.id,
        channel: c.channel,
        sourceType: 'campaign',
        klaviyoResourceId: c.id,
        name: c.name.slice(0, 512),
        sendDate,
        delivered: Math.round(st.delivered),
        uniqueOpens: Math.round(st.uniqueOpens),
        uniqueClicks: Math.round(st.uniqueClicks),
        orders: Math.round(st.orders),
        revenue: st.revenue,
        unsubscribes: Math.round(st.unsubscribes),
        spamComplaints: Math.round(st.spamComplaints),
      },
      update: {
        name: c.name.slice(0, 512),
        channel: c.channel,
        delivered: Math.round(st.delivered),
        uniqueOpens: Math.round(st.uniqueOpens),
        uniqueClicks: Math.round(st.uniqueClicks),
        orders: Math.round(st.orders),
        revenue: st.revenue,
        unsubscribes: Math.round(st.unsubscribes),
        spamComplaints: Math.round(st.spamComplaints),
        syncedAt: new Date(),
      },
    })
    campaignsSynced++
  }

  let flowDaysSynced = 0
  for (const p of flowPoints) {
    if (p.stats.delivered === 0 && p.stats.revenue === 0 && p.stats.uniqueOpens === 0) continue
    const sendDate = new Date(p.date + 'T12:00:00.000Z')
    const resourceId = `${p.channel[0]}:${p.flowId}:${p.date}`.slice(0, 64)
    await prisma.emailPerformance.upsert({
      where: {
        workspaceId_sourceType_klaviyoResourceId_sendDate: {
          workspaceId,
          sourceType: 'flow',
          klaviyoResourceId: resourceId,
          sendDate,
        },
      },
      create: {
        workspaceId,
        klaviyoConnectionId: conn.id,
        channel: p.channel,
        sourceType: 'flow',
        klaviyoResourceId: resourceId,
        name: `${p.flowName}`.slice(0, 512),
        sendDate,
        delivered: Math.round(p.stats.delivered),
        uniqueOpens: Math.round(p.stats.uniqueOpens),
        uniqueClicks: Math.round(p.stats.uniqueClicks),
        orders: Math.round(p.stats.orders),
        revenue: p.stats.revenue,
        unsubscribes: Math.round(p.stats.unsubscribes),
        spamComplaints: Math.round(p.stats.spamComplaints),
      },
      update: {
        name: `${p.flowName}`.slice(0, 512),
        delivered: Math.round(p.stats.delivered),
        uniqueOpens: Math.round(p.stats.uniqueOpens),
        uniqueClicks: Math.round(p.stats.uniqueClicks),
        orders: Math.round(p.stats.orders),
        revenue: p.stats.revenue,
        unsubscribes: Math.round(p.stats.unsubscribes),
        spamComplaints: Math.round(p.stats.spamComplaints),
        syncedAt: new Date(),
      },
    })
    flowDaysSynced++
  }

  await prisma.klaviyoConnection.update({
    where: { id: conn.id },
    data: { lastSyncAt: new Date(), lastSyncError: null },
  })

  return { campaignsSynced, flowDaysSynced }
}
