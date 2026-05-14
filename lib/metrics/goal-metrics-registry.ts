/**
 * Canonical goal metric ids — extend here; keep in sync with evaluation + APIs.
 */
export const GOAL_METRIC_IDS = [
  'revenue',
  'cm3',
  'cm3_pct',
  'mer',
  'amer',
  'cac',
  'aov',
  'new_customers',
  'acos',
  'meta_roas',
  'google_roas',
] as const

export type GoalMetricId = (typeof GOAL_METRIC_IDS)[number]

export function isGoalMetricId(s: string): s is GoalMetricId {
  return (GOAL_METRIC_IDS as readonly string[]).includes(s)
}

/** Default direction for TARGET. MINIMUM = higher-is-better; MAXIMUM = lower-is-better. */
export type GoalMetricMeta = {
  label: string
  description: string
  higherBetter: boolean
  unit: 'currency' | 'percent' | 'ratio' | 'count'
}

export const GOAL_METRIC_REGISTRY: Record<GoalMetricId, GoalMetricMeta> = {
  revenue: {
    label: 'Net revenue',
    description: 'Store net sales (selected range)',
    higherBetter: true,
    unit: 'currency',
  },
  cm3: {
    label: 'CM3',
    description: 'Contribution margin 3 after misc expenses',
    higherBetter: true,
    unit: 'currency',
  },
  cm3_pct: {
    label: 'CM3 %',
    description: 'CM3 ÷ net sales × 100',
    higherBetter: true,
    unit: 'percent',
  },
  mer: {
    label: 'MER',
    description: 'Net revenue ÷ total ad spend',
    higherBetter: true,
    unit: 'ratio',
  },
  amer: {
    label: 'aMER',
    description: 'New-customer revenue ÷ acquisition ad spend',
    higherBetter: true,
    unit: 'ratio',
  },
  cac: {
    label: 'Blended CAC',
    description: 'Acquisition cost per new customer',
    higherBetter: false,
    unit: 'currency',
  },
  aov: {
    label: 'AOV',
    description: 'Average order value',
    higherBetter: true,
    unit: 'currency',
  },
  new_customers: {
    label: 'New customers',
    description: 'First-order customers in range',
    higherBetter: true,
    unit: 'count',
  },
  acos: {
    label: 'ACOS',
    description: 'Ad spend ÷ net sales × 100',
    higherBetter: false,
    unit: 'percent',
  },
  meta_roas: {
    label: 'Meta ROAS',
    description: 'Attributed purchase value ÷ Meta spend',
    higherBetter: true,
    unit: 'ratio',
  },
  google_roas: {
    label: 'Google ROAS',
    description: 'Conversion value ÷ Google spend',
    higherBetter: true,
    unit: 'ratio',
  },
}

export const GOAL_METRIC_OPTIONS = GOAL_METRIC_IDS.map((id) => ({
  id,
  ...GOAL_METRIC_REGISTRY[id],
}))
