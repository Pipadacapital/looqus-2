import { getDaysInMonth } from 'date-fns'

/**
 * Centralized resolution of workspace cost contribution for profitability calculations.
 * Used by Analytics, P&L, Products, Cohorts, LTV, and workspace daily metrics.
 * "Relevant orders" are determined by the caller (filtered by workspace order filters).
 */

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  INR: 83.5,
  EUR: 0.92,
  GBP: 0.79,
  AUD: 1.53,
  CAD: 1.35,
}

function convertCurrency(amount: number, from: string, to: string): number {
  if (!from || !to || from === to) return amount
  const fromRate = EXCHANGE_RATES[from] || 1
  const toRate = EXCHANGE_RATES[to] || 1
  return (amount / fromRate) * toRate
}

export type WorkspaceCostBillingMode = 'monthly' | 'per_order'

export type WorkspaceCostForContribution = {
  costType: string
  amount: number
  currency: string | null
  isPercent: boolean
  billingMode?: WorkspaceCostBillingMode | null
}

/**
 * Resolve the variable cost contribution for a single workspace cost on a single day.
 * Callers must pass the same order count basis they use elsewhere (filtered by workspace
 * skipped tags, zero-sales exclusion, connection scope).
 *
 * - SHIPPING / PACKAGING:
 *   - billingMode monthly: daily share = amount / daysInMonth (flat monthly spread across the month).
 *   - billingMode per_order (or legacy null/undefined): daily contribution = amount × ordersCount.
 * - WEBSITE: percent → (amount/100) × grossSales; else amount × ordersCount (unchanged).
 * - CUSTOM: amount × ordersCount (unchanged).
 */
export function getDailyVariableContribution(
  cost: WorkspaceCostForContribution,
  dateStr: string,
  ordersCount: number,
  grossSales: number,
  storeCurrency: string
): number {
  const costFrom = cost.currency ?? 'USD'
  const amount = convertCurrency(cost.amount, costFrom, storeCurrency)
  const mode = cost.billingMode ?? 'monthly'

  if (cost.costType === 'SHIPPING' || cost.costType === 'PACKAGING') {
    if (mode === 'per_order') {
      return amount * ordersCount
    }
    // monthly: allocate the monthly amount evenly across the month
    const dayDate = new Date(dateStr + 'T12:00:00.000Z')
    const daysInMonth = getDaysInMonth(dayDate)
    return amount / daysInMonth
  }

  if (cost.costType === 'WEBSITE') {
    if (cost.isPercent) return (cost.amount / 100) * grossSales
    return amount * ordersCount
  }

  if (cost.costType === 'CUSTOM') {
    return amount * ordersCount
  }

  return 0
}
