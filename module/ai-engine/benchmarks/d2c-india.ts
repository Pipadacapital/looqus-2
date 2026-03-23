/**
 * D2C India industry benchmarks.
 * Used by the AI system prompt to contextualize metric values.
 *
 * Convention:
 *   good     = healthy / target range
 *   warning  = needs attention
 *   critical = urgent action needed
 *
 * For "lower is better" metrics (cogsPct, acos, rtoRate, refundRate),
 * thresholds are inverted: good < warning < critical.
 */

export const D2C_INDIA_BENCHMARKS = {
  margins: {
    cm1Pct:       { good: 40, warning: 30, critical: 20, unit: '%', direction: 'higher_better' as const },
    cm2Pct:       { good: 25, warning: 15, critical: 5,  unit: '%', direction: 'higher_better' as const },
    cm3Pct:       { good: 20, warning: 10, critical: 0,  unit: '%', direction: 'higher_better' as const },
    netProfitPct: { good: 15, warning: 5,  critical: -5, unit: '%', direction: 'higher_better' as const },
    cogsPct:      { good: 30, warning: 45, critical: 55, unit: '%', direction: 'lower_better' as const },
  },
  ads: {
    mer:  { good: 4,  warning: 2.5, critical: 1.5, unit: 'x',  direction: 'higher_better' as const },
    roas: { good: 3,  warning: 2,   critical: 1.2, unit: 'x',  direction: 'higher_better' as const },
    acos: { good: 15, warning: 25,  critical: 40,  unit: '%', direction: 'lower_better' as const },
  },
  logistics: {
    rtoRate:     { good: 10, warning: 20, critical: 30, unit: '%', direction: 'lower_better' as const },
    deliveryPct: { good: 85, warning: 70, critical: 55, unit: '%', direction: 'higher_better' as const },
  },
  customers: {
    refundRate: { good: 3,  warning: 8,  critical: 15, unit: '%', direction: 'lower_better' as const },
    prepaidPct: { good: 50, warning: 30, critical: 15, unit: '%', direction: 'higher_better' as const },
    repeatRate: { good: 30, warning: 15, critical: 5,  unit: '%', direction: 'higher_better' as const },
  },
  ltv: {
    ltvCacRatio: { good: 3, warning: 1.5, critical: 1, unit: 'x', direction: 'higher_better' as const },
  },
} as const

export type BenchmarkCategory = keyof typeof D2C_INDIA_BENCHMARKS
