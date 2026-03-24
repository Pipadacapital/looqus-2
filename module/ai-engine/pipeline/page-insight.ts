import type { PrismaClient } from '@prisma/client'
import { getProvider, getDefaultModel } from '../providers/router'
import { getSystemPrompt } from '../prompts/system'
import { buildAnalyticsPrompt } from '../prompts/page/analytics'
import { comparePeriods, ANALYTICS_METRIC_KEYS, PNL_METRIC_KEYS, ACQUISITION_METRIC_KEYS, COHORTS_METRIC_KEYS, META_ADS_METRIC_KEYS, GOOGLE_ADS_METRIC_KEYS, LOGISTICS_METRIC_KEYS, COD_PREPAID_METRIC_KEYS, RTO_ANALYTICS_METRIC_KEYS, PRODUCTS_METRIC_KEYS, PINCODE_INTELLIGENCE_METRIC_KEYS, LTV_METRIC_KEYS, WATERFALL_METRIC_KEYS } from '../analysis/comparator'
import { detectAnomalies } from '../analysis/anomaly'
import { analyzeTrends } from '../analysis/trend'
import { buildAnalyticsContext } from '../context-adapters/analytics'
import { buildPnlContext } from '../context-adapters/pnl'
import { buildAcquisitionContext } from '../context-adapters/acquisition'
import { buildCohortsContext } from '../context-adapters/cohorts'
import { buildMetaAdsContext } from '../context-adapters/meta-ads'
import { buildGoogleAdsContext } from '../context-adapters/google-ads'
import { buildLogisticsContext } from '../context-adapters/logistics'
import { buildCodPrepaidContext } from '../context-adapters/cod-prepaid'
import { buildRtoAnalyticsContext } from '../context-adapters/rto-analytics'
import { buildProductsContext } from '../context-adapters/products'
import { buildPincodeIntelligenceContext } from '../context-adapters/pincode-intelligence'
import { buildLtvContext } from '../context-adapters/lifetime-value'
import { buildWaterfallContext } from '../context-adapters/waterfall'
import { buildPnlPrompt } from '../prompts/page/pnl'
import { buildAcquisitionPrompt } from '../prompts/page/acquisition'
import { buildCohortsPrompt } from '../prompts/page/cohorts'
import { buildMetaAdsPrompt } from '../prompts/page/meta-ads'
import { buildGoogleAdsPrompt } from '../prompts/page/google-ads'
import { buildLogisticsPrompt } from '../prompts/page/logistics'
import { buildCodPrepaidPrompt } from '../prompts/page/cod-prepaid'
import { buildRtoAnalyticsPrompt } from '../prompts/page/rto-analytics'
import { buildProductsPrompt } from '../prompts/page/products'
import { buildPincodeIntelligencePrompt } from '../prompts/page/pincode-intelligence'
import { buildLtvPrompt } from '../prompts/page/lifetime-value'
import { buildWaterfallPrompt } from '../prompts/page/waterfall'
import { computeCacheKey, getCachedInsight, saveInsight } from '../cache/insight-cache'

export type InsightItem = {
  title: string
  severity: 'critical' | 'warning' | 'opportunity' | 'positive'
  confidence: number
  summary: string
  detail: string
  recommendation: string
  metrics: string[]
}

export type InsightResult = {
  insights: InsightItem[]
  modelUsed: string
  cached: boolean
  error?: 'insufficient_data' | 'no_connection'
  message?: string
  dataThrough?: string
}

/**
 * Generates page insights by orchestrating the full pipeline:
 * cache check → context adapter → analysis → prompt → AI → parse JSON → cache
 */
export async function generatePageInsight(
  prisma: PrismaClient,
  workspaceId: string,
  page: string,
  dateFrom: Date,
  dateTo: Date,
  options?: { forceRefresh?: boolean }
): Promise<InsightResult> {
  const fromStr = dateFrom.toISOString().slice(0, 10)
  const toStr = dateTo.toISOString().slice(0, 10)
  const filtersHash = computeCacheKey(workspaceId, page, fromStr, toStr)
  const model = getDefaultModel(page)

  // 1. Check cache (unless force refresh)
  if (!options?.forceRefresh) {
    const cached = await getCachedInsight(prisma, workspaceId, filtersHash)
    if (cached && !cached.isExpired) {
      try {
        const parsed = parseInsightsJson(cached.content)
        const cachedMeta = cached.metadata as Record<string, unknown> | null
        return {
          insights: parsed,
          modelUsed: 'cache',
          cached: true,
          dataThrough: (cachedMeta?.dataThrough as string) ?? undefined,
        }
      } catch {
        // Cache has invalid JSON — regenerate
      }
    }
  }

  // 2. Build context (adapter call)
  const context = await getContextForPage(prisma, workspaceId, page, dateFrom, dateTo)

  // 2a. Data sufficiency check — need at least 3 days for meaningful analysis
  const lastDataDate = context.daily.length > 0
    ? context.daily[context.daily.length - 1].date
    : null
  const dataThrough = lastDataDate ?? undefined

  if (context.daily.length < 3) {
    return {
      insights: [],
      modelUsed: 'none',
      cached: false,
      error: 'insufficient_data',
      message: 'Not enough data for this period. Try a longer date range or wait for the next sync.',
      dataThrough,
    }
  }

  // 3. Run analysis
  const metricKeys = getMetricKeysForPage(page)
  const comparison = comparePeriods(
    context.summary,
    context.priorSummary,
    metricKeys
  )

  const dailyMetrics = getDailyMetricsForPage(page)
  const anomalies = detectAnomalies(context.daily as any[], dailyMetrics)
  const trends = analyzeTrends(context.daily as any[], dailyMetrics)

  // 4. Build prompt
  const userPrompt = getPromptForPage(page, context, comparison, anomalies, trends)
  const systemPrompt = getSystemPrompt(context.currency, page)

  // 5. Call AI provider and accumulate full response
  const provider = getProvider()
  const startTime = Date.now()
  const result = await provider.generateStream(userPrompt, {
    model,
    systemPrompt,
    temperature: 0.3,
    maxTokens: 2048,
  })

  let fullContent = ''
  let tokensUsed = 0

  for await (const chunk of result.stream) {
    if (chunk.delta) {
      fullContent += chunk.delta
    }
    if (chunk.done && (chunk as any).usage) {
      tokensUsed = (chunk as any).usage.outputTokens ?? 0
    }
  }

  const latencyMs = Date.now() - startTime

  // 6. Parse JSON response
  const insights = parseInsightsJson(fullContent)

  // 7. Save to cache
  try {
    await saveInsight(prisma, {
      workspaceId,
      page,
      dateFrom,
      dateTo,
      filtersHash,
      content: fullContent,
      provider: provider.name,
      model: result.modelUsed,
      tokensUsed: tokensUsed || Math.ceil(fullContent.length / 4),
      latencyMs,
      metadata: dataThrough ? { dataThrough } : undefined,
    })
  } catch {
    // Cache save failure should not break the response
  }

  return {
    insights,
    modelUsed: result.modelUsed,
    cached: false,
    dataThrough,
  }
}

/**
 * Parses the AI response into structured InsightItem array.
 * Handles JSON wrapped in markdown code fences, raw JSON, or partial JSON.
 */
function parseInsightsJson(raw: string): InsightItem[] {
  // Strip markdown code fences if present
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  // Find the JSON object
  const startIdx = cleaned.indexOf('{')
  const endIdx = cleaned.lastIndexOf('}')
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('No JSON object found in AI response')
  }

  const jsonStr = cleaned.slice(startIdx, endIdx + 1)
  const parsed = JSON.parse(jsonStr)

  if (!parsed.insights || !Array.isArray(parsed.insights)) {
    throw new Error('AI response missing insights array')
  }

  return parsed.insights.map((item: any) => ({
    title: String(item.title ?? 'Untitled'),
    severity: validateSeverity(item.severity),
    confidence: Math.min(100, Math.max(0, Number(item.confidence) || 70)),
    summary: String(item.summary ?? ''),
    detail: String(item.detail ?? ''),
    recommendation: String(item.recommendation ?? ''),
    metrics: Array.isArray(item.metrics) ? item.metrics.map(String) : [],
  }))
}

function validateSeverity(val: any): InsightItem['severity'] {
  const valid = ['critical', 'warning', 'opportunity', 'positive']
  return valid.includes(val) ? val : 'warning'
}

/**
 * Returns the comparison metric keys for a given page.
 */
function getMetricKeysForPage(page: string): string[] {
  switch (page) {
    case 'pnl':
      return [...PNL_METRIC_KEYS]
    case 'acquisition':
      return [...ACQUISITION_METRIC_KEYS]
    case 'cohorts':
      return [...COHORTS_METRIC_KEYS]
    case 'meta-ads':
      return [...META_ADS_METRIC_KEYS]
    case 'google-ads':
      return [...GOOGLE_ADS_METRIC_KEYS]
    case 'logistics':
      return [...LOGISTICS_METRIC_KEYS]
    case 'cod-prepaid':
      return [...COD_PREPAID_METRIC_KEYS]
    case 'rto-analytics':
      return [...RTO_ANALYTICS_METRIC_KEYS]
    case 'products':
      return [...PRODUCTS_METRIC_KEYS]
    case 'pincode-intelligence':
      return [...PINCODE_INTELLIGENCE_METRIC_KEYS]
    case 'lifetime-value':
      return [...LTV_METRIC_KEYS]
    case 'waterfall':
      return [...WATERFALL_METRIC_KEYS]
    default:
      return [...ANALYTICS_METRIC_KEYS]
  }
}

/**
 * Returns the daily metric names for anomaly/trend analysis per page.
 */
function getDailyMetricsForPage(page: string): string[] {
  switch (page) {
    case 'pnl':
      return ['netSales', 'cogs', 'variableCosts', 'adSpend', 'cm1', 'cm2', 'cm3', 'netProfit']
    case 'acquisition':
      return ['ncCm2', 'adSpend', 'newCustomers', 'blendedCac', 'ncRevenue', 'aMer']
    case 'cohorts':
      return ['nc', 'cac', 'rr90', 'payback', 'firstOrder', 'cm3M3', 'cm3M6', 'cm3M12']
    case 'meta-ads':
      return ['spend', 'revenue', 'roas', 'impressions', 'clicks', 'conversions']
    case 'google-ads':
      return ['spend', 'conversionValue', 'roas', 'impressions', 'clicks', 'conversions']
    case 'logistics':
      return ['shipments', 'rto', 'rtoRate', 'totalCharges', 'forwardCharges']
    case 'cod-prepaid':
      return ['codRtoRate', 'codOrders', 'prepaidOrders']
    case 'rto-analytics':
      return ['rtoCount', 'rtoRate', 'rtoCost', 'revenueLost']
    case 'products':
      return ['revenue', 'orders']
    case 'pincode-intelligence':
      return ['shipments', 'rtoCount', 'rtoRate']
    case 'lifetime-value':
      return ['m1', 'm3', 'm6', 'm12', 'retentionRatio']
    case 'waterfall':
      return ['value', 'pctOfGross']
    default:
      return ['netSales', 'ordersCount', 'aov', 'cogs', 'adSpend', 'cm1', 'cm2']
  }
}

/**
 * Routes to the correct context adapter based on page.
 */
async function getContextForPage(
  prisma: PrismaClient,
  workspaceId: string,
  page: string,
  dateFrom: Date,
  dateTo: Date
) {
  switch (page) {
    case 'analytics':
      return buildAnalyticsContext(prisma, workspaceId, dateFrom, dateTo)
    case 'pnl':
      return buildPnlContext(prisma, workspaceId, dateFrom, dateTo)
    case 'acquisition':
      return buildAcquisitionContext(prisma, workspaceId, dateFrom, dateTo)
    case 'cohorts':
      return buildCohortsContext(prisma, workspaceId, dateFrom, dateTo)
    case 'meta-ads':
      return buildMetaAdsContext(prisma, workspaceId, dateFrom, dateTo)
    case 'google-ads':
      return buildGoogleAdsContext(prisma, workspaceId, dateFrom, dateTo)
    case 'logistics':
      return buildLogisticsContext(prisma, workspaceId, dateFrom, dateTo)
    case 'cod-prepaid':
      return buildCodPrepaidContext(prisma, workspaceId, dateFrom, dateTo)
    case 'rto-analytics':
      return buildRtoAnalyticsContext(prisma, workspaceId, dateFrom, dateTo)
    case 'products':
      return buildProductsContext(prisma, workspaceId, dateFrom, dateTo)
    case 'pincode-intelligence':
      return buildPincodeIntelligenceContext(prisma, workspaceId, dateFrom, dateTo)
    case 'lifetime-value':
      return buildLtvContext(prisma, workspaceId, dateFrom, dateTo)
    case 'waterfall':
      return buildWaterfallContext(prisma, workspaceId, dateFrom, dateTo)
    default:
      throw new Error(`Unsupported page for insights: ${page}`)
  }
}

/**
 * Routes to the correct prompt builder based on page.
 */
function getPromptForPage(
  page: string,
  context: any,
  comparison: any,
  anomalies: any,
  trends: any
): string {
  switch (page) {
    case 'analytics':
      return buildAnalyticsPrompt(context, comparison, anomalies, trends)
    case 'pnl':
      return buildPnlPrompt(context, comparison, anomalies, trends)
    case 'acquisition':
      return buildAcquisitionPrompt(context, comparison, anomalies, trends)
    case 'cohorts':
      return buildCohortsPrompt(context, comparison, anomalies, trends)
    case 'meta-ads':
      return buildMetaAdsPrompt(context, comparison, anomalies, trends)
    case 'google-ads':
      return buildGoogleAdsPrompt(context, comparison, anomalies, trends)
    case 'logistics':
      return buildLogisticsPrompt(context, comparison, anomalies, trends)
    case 'cod-prepaid':
      return buildCodPrepaidPrompt(context, comparison, anomalies, trends)
    case 'rto-analytics':
      return buildRtoAnalyticsPrompt(context, comparison, anomalies, trends)
    case 'products':
      return buildProductsPrompt(context, comparison, anomalies, trends)
    case 'pincode-intelligence':
      return buildPincodeIntelligencePrompt(context, comparison, anomalies, trends)
    case 'lifetime-value':
      return buildLtvPrompt(context, comparison, anomalies, trends)
    case 'waterfall':
      return buildWaterfallPrompt(context, comparison, anomalies, trends)
    default:
      throw new Error(`Unsupported page for prompts: ${page}`)
  }
}
