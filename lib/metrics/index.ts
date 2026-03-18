export type {
  MetricsWorkspaceContext,
  CampaignIntent,
  AdPlatform,
  WorkspaceCampaignClassification,
  MarketingEfficiencySnapshot,
} from './types'

export { computeMarketingEfficiency, type MarketingEfficiencyInput } from './marketing-efficiency'

export {
  normalizeCampaignIntent,
  classificationKey,
  loadCampaignIntentMap,
  resolveCampaignIntent,
  upsertWorkspaceCampaignClassification,
  listWorkspaceCampaignClassifications,
  type ClassificationKey,
} from './campaign-classification'

export {
  fetchAdSpendMapsWithClassification,
  fetchStoreNetRevenueForPeriod,
  fetchCampaignsWithSpendInRange,
  sumDailyMapInRange,
  type WorkspaceAdsConnections,
  type AdSpendMapsWithClassification,
  type CampaignSpendRow,
} from './ads-spend'

export {
  fetchCustomerFirstOrdersInRange,
  type CustomerFirstOrderRow,
} from './customer-first-order'

export {
  emptyIntentBuckets,
  addMetricToIntentBuckets,
  buildIntentSplitPayload,
  matchesIntentFilter,
  type IntentSplitPayload,
  type IntentBucket,
} from './ad-intent-split'

export {
  type OrderFilterSettings,
  normalizeOrderFilterSettings,
  getOrderInclusionWhere,
  getOrderInclusionWhereFromWorkspace,
  getOrderInclusionRawFragment,
  getFilteredDailyAggregates,
  hasNoOrderFilters,
  type FilteredDailyRow,
} from './order-inclusion'

export {
  computeChurnThresholds,
  MIN_GAPS_FOR_EMPIRICAL,
  FALLBACK_P40_DAYS,
  FALLBACK_P80_DAYS,
  type ChurnThresholdsResult,
} from './churn-thresholds'

export {
  classifyCustomerLifecycle,
  emptyLifecycleCounts,
  netActiveCount,
  LIFECYCLE_BUCKETS,
  type LifecycleBucket,
  type LifecycleClassifyInput,
} from './customer-lifecycle'

export {
  computeCustomerLifecycleReport,
  type CustomerLifecycleReportPayload,
} from './customer-lifecycle-report'

export {
  computeFirstProductCascade,
  pickPrimaryFirstProductLine,
  EMPTY_FIRST_ORDER_KEY,
  NO_PRODUCT_KEY,
  type FirstProductCascadeRow,
  type FirstProductCascadeResult,
} from './first-product-cascade'

export {
  computePaidMediaFunnel,
  parseMetaFunnelActionsFromRaw,
  diagnoseMetaFunnel,
  diagnoseGoogleFunnel,
  googleMergedFunnelSnapshot,
  type PaidMediaFunnelSnapshot,
  type FunnelBand,
  type GoogleStagedFunnelCounts,
} from './paid-media-funnel'

export { mapGoogleConversionActionToStage, type GoogleFunnelStage } from './google-funnel-stage'
export {
  addFunnelDailyRow,
  emptyGoogleStagedCounts,
  hasStagedFunnelData,
} from './google-funnel-aggregate'

export {
  GOAL_METRIC_IDS,
  GOAL_METRIC_REGISTRY,
  GOAL_METRIC_OPTIONS,
  isGoalMetricId,
  type GoalMetricId,
} from './goal-metrics-registry'
export {
  goalPeriodAnchor,
  computeGoalRag,
  evaluateGoalRow,
  fetchGoalRowsMap,
  buildGoalEvaluations,
  type GoalRag,
  type GoalEvaluation,
} from './goals'

export {
  computeCalendarReport,
  MAX_CALENDAR_DAYS,
  MARKETING_ACTION_TYPES,
  isMarketingActionType,
  type CalendarReportRow,
  type CalendarMetricCell,
  type MarketingActionTypeV1,
} from './calendar-report'
