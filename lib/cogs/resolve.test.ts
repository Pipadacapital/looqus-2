/**
 * Consistency check: the same line item under the same settings must resolve to the same COGS
 * in analytics, pnl, products, cohorts, and lifetime-value. All those call resolveLineItemCogs
 * from this module, so this test verifies deterministic behavior and documents expected values.
 *
 * Run with: npx tsx lib/cogs/resolve.test.ts
 */
import { assertSameCogsForSameInput, resolveLineItemCogs, normalizeCogsSettings } from './resolve'

function runConsistencyCheck() {
  const coqMap = new Map<string, number>([
    ['prod-1', 10],
    ['prod-2', 0],
  ])
  const lineItem = { price: 100, quantity: 2, productShopifyId: 'prod-1' }

  // Same input twice -> same output
  assertSameCogsForSameInput(lineItem, coqMap, normalizeCogsSettings(null))
  assertSameCogsForSameInput(
    lineItem,
    coqMap,
    normalizeCogsSettings({
      overrideAllCogsPercent: 50,
      fallbackCogsPercent: 20,
      cogsMarkupPercent: 10,
    })
  )

  // Override ON: COGS = revenue * overridePct/100; revenue = 100*2 = 200, 50% => 100, markup 10% => 110
  const withOverride = resolveLineItemCogs(
    lineItem,
    coqMap,
    normalizeCogsSettings({
      overrideAllCogsPercent: 50,
      fallbackCogsPercent: 20,
      cogsMarkupPercent: 10,
    })
  )
  if (Math.abs(withOverride - 110) > 0.01) {
    throw new Error(`Expected override COGS 110, got ${withOverride}`)
  }

  // Override OFF, product has coq: COGS = 10*2 = 20, markup 10% => 22
  const withCoq = resolveLineItemCogs(
    lineItem,
    coqMap,
    normalizeCogsSettings({ overrideAllCogsPercent: 0, fallbackCogsPercent: 20, cogsMarkupPercent: 10 })
  )
  if (Math.abs(withCoq - 22) > 0.01) {
    throw new Error(`Expected product COQ COGS 22, got ${withCoq}`)
  }

  // Override OFF, no coq, fallback 20%: revenue 200 * 0.2 = 40
  const withFallback = resolveLineItemCogs(
    { ...lineItem, productShopifyId: 'prod-2' },
    coqMap,
    normalizeCogsSettings({ overrideAllCogsPercent: 0, fallbackCogsPercent: 20, cogsMarkupPercent: 0 })
  )
  if (Math.abs(withFallback - 40) > 0.01) {
    throw new Error(`Expected fallback COGS 40, got ${withFallback}`)
  }

  console.log('lib/cogs consistency check passed')
}

runConsistencyCheck()
