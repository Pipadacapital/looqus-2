/**
 * Maps Google Ads conversion_action (category + name) to canonical funnel stages.
 *
 * **Order**: Purchase first (avoid classifying a “Purchase” named ATC as cart).
 *
 * **Categories** (Google Ads API enum names, case-insensitive):
 * - `PURCHASE` → purchase
 * - `BEGIN_CHECKOUT` → checkout_initiated
 * - `ADD_TO_CART` → add_to_cart
 *
 * **Name fallbacks** (lowercase): purchase/transaction/order complete → purchase;
 * begin checkout / initiate checkout → checkout; add to cart → add_to_cart.
 *
 * Unmapped actions (PAGE_VIEW, LEAD, etc.) return null and are not summed into funnel.
 */

export type GoogleFunnelStage = 'add_to_cart' | 'checkout_initiated' | 'purchase'

export function mapGoogleConversionActionToStage(
  category: string | undefined | null,
  name: string | undefined | null
): GoogleFunnelStage | null {
  const c = (category ?? '').toString().toUpperCase().replace(/ /g, '_')
  const n = (name ?? '').toLowerCase()

  if (c === 'PURCHASE' || /\b(purchase|transaction|order\s*complete|placed\s*order)\b/.test(n)) {
    return 'purchase'
  }
  if (
    c === 'BEGIN_CHECKOUT' ||
    /\b(begin\s*checkout|initiate\s*checkout|started\s*checkout|checkout\s*started)\b/.test(n)
  ) {
    return 'checkout_initiated'
  }
  if (
    c === 'ADD_TO_CART' ||
    /add\s*to\s*(cart|basket)|add_to_cart|\baddtocart\b|\batc\b/.test(n)
  ) {
    return 'add_to_cart'
  }
  return null
}
