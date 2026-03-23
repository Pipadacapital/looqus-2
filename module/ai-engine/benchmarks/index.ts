import { D2C_INDIA_BENCHMARKS, type BenchmarkCategory } from './d2c-india'

/** Which benchmark categories are relevant for each page */
const PAGE_BENCHMARKS: Record<string, BenchmarkCategory[]> = {
  analytics:  ['margins', 'ads', 'logistics', 'customers'],
  pnl:        ['margins', 'ads'],
  acquisition:['ads', 'customers'],
  cohorts:    ['customers', 'ltv'],
  'lifetime-value': ['ltv', 'customers'],
  'meta-ads': ['ads'],
  'google-ads': ['ads'],
  logistics:  ['logistics'],
  'rto-analytics': ['logistics'],
  'cod-prepaid': ['customers'],
  products:   ['margins'],
  'email-sms': ['customers'],
  timings:    ['customers'],
  distributions: ['margins'],
}

function formatBenchmark(
  name: string,
  b: { good: number; warning: number; critical: number; unit: string; direction: string }
): string {
  if (b.direction === 'lower_better') {
    return `${name}: <${b.good}${b.unit} good, ${b.good}-${b.warning}${b.unit} warning, >${b.critical}${b.unit} critical`
  }
  return `${name}: >${b.good}${b.unit} good, ${b.warning}-${b.good}${b.unit} warning, <${b.critical}${b.unit} critical`
}

/**
 * Returns a compact benchmark reference block filtered by page.
 * For 'global' or undefined, returns all benchmarks.
 */
export function getBenchmarksBlock(page?: string): string {
  const categories: BenchmarkCategory[] = page && page !== 'global'
    ? PAGE_BENCHMARKS[page] ?? Object.keys(D2C_INDIA_BENCHMARKS) as BenchmarkCategory[]
    : Object.keys(D2C_INDIA_BENCHMARKS) as BenchmarkCategory[]

  const lines: string[] = []

  for (const cat of categories) {
    const group = D2C_INDIA_BENCHMARKS[cat]
    for (const [name, b] of Object.entries(group)) {
      lines.push(formatBenchmark(name, b))
    }
  }

  return lines.join('\n')
}
