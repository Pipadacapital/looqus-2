import type { MarketingEfficiencySnapshot } from './types'

export type MarketingEfficiencyInput = {
  storeNetRevenue: number
  totalAdSpend: number
  newCustomerRevenue: number
  acquisitionAdSpend: number
}

/**
 * Pure MER / aMER / ACOS (aligned with shopify-analytics + ai-calc rounding).
 * - MER: store net revenue ÷ all ad spend in period (denominator).
 * - aMER: new-customer revenue ÷ spend on campaigns tagged acquisition only;
 *   unclassified / non_acquisition / brand spend is excluded from the denominator (conservative).
 * - MER null when no ad spend; aMER null when acquisition spend is 0; ACOS null when store net is 0.
 */
export function computeMarketingEfficiency(
  input: MarketingEfficiencyInput
): MarketingEfficiencySnapshot {
  const { storeNetRevenue, totalAdSpend, newCustomerRevenue, acquisitionAdSpend } = input
  const mer =
    totalAdSpend > 0
      ? Math.round((storeNetRevenue / totalAdSpend) * 100) / 100
      : null
  const aMer =
    acquisitionAdSpend > 0
      ? Math.round((newCustomerRevenue / acquisitionAdSpend) * 100) / 100
      : null
  const acos =
    storeNetRevenue > 0
      ? Math.round((totalAdSpend / storeNetRevenue) * 10000) / 100
      : null

  return {
    totalAdSpend,
    storeNetRevenue,
    mer,
    newCustomerRevenue,
    acquisitionAdSpend,
    aMer,
    acos,
  }
}
