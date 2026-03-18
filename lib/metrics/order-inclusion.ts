/**
 * Facade: workspace order inclusion for analytics (tags, zero-sales skip).
 */
export {
  type OrderFilterSettings,
  normalizeOrderFilterSettings,
  getOrderInclusionWhere,
  getOrderInclusionWhereFromWorkspace,
  getOrderInclusionRawFragment,
  getFilteredDailyAggregates,
  hasNoOrderFilters,
  type FilteredDailyRow,
} from '@/lib/order-filters'
