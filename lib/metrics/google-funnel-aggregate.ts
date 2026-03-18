import type { GoogleStagedFunnelCounts } from './paid-media-funnel'

export function emptyGoogleStagedCounts(): GoogleStagedFunnelCounts {
  return {
    addToCart: 0,
    checkoutInitiated: 0,
    purchases: 0,
    purchaseValue: 0,
  }
}

export function addFunnelDailyRow(
  acc: GoogleStagedFunnelCounts,
  row: { stage: string; conversions: unknown; conversion_value: unknown }
): void {
  const c = Number(row.conversions) || 0
  const v = Number(row.conversion_value) || 0
  if (row.stage === 'add_to_cart') acc.addToCart += c
  else if (row.stage === 'checkout_initiated') acc.checkoutInitiated += c
  else if (row.stage === 'purchase') {
    acc.purchases += c
    acc.purchaseValue += v
  }
}

export function hasStagedFunnelData(acc: GoogleStagedFunnelCounts): boolean {
  return (
    acc.addToCart > 0 ||
    acc.checkoutInitiated > 0 ||
    acc.purchases > 0 ||
    acc.purchaseValue > 0
  )
}
