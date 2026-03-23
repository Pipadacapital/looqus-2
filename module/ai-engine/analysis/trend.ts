export type TrendResult = {
  metric: string
  direction: 'up' | 'down' | 'flat'
  velocity: number
  consistency: number
}

/**
 * Analyzes trends in daily time series via simple linear regression.
 * Returns direction (up/down/flat), velocity (slope as % of mean per day),
 * and consistency (R² — how monotonic the trend is, 0–1).
 */
export function analyzeTrends(
  daily: Array<Record<string, number | string | null | undefined>>,
  metrics: string[]
): TrendResult[] {
  if (daily.length < 3) return []

  const results: TrendResult[] = []

  for (const metric of metrics) {
    const values: number[] = []
    for (const row of daily) {
      const val = row[metric]
      if (typeof val === 'number' && !isNaN(val)) {
        values.push(val)
      } else {
        values.push(0)
      }
    }

    if (values.length < 3) continue

    const n = values.length
    const meanX = (n - 1) / 2
    const meanY = values.reduce((a, b) => a + b, 0) / n

    let sumXYDev = 0
    let sumXDev2 = 0
    let sumYDev2 = 0

    for (let i = 0; i < n; i++) {
      const xDev = i - meanX
      const yDev = values[i] - meanY
      sumXYDev += xDev * yDev
      sumXDev2 += xDev * xDev
      sumYDev2 += yDev * yDev
    }

    const slope = sumXDev2 !== 0 ? sumXYDev / sumXDev2 : 0
    const rSquared = sumXDev2 !== 0 && sumYDev2 !== 0
      ? (sumXYDev * sumXYDev) / (sumXDev2 * sumYDev2)
      : 0

    const velocity = meanY !== 0 ? (slope / Math.abs(meanY)) * 100 : 0

    const FLAT_THRESHOLD = 0.5 // less than 0.5% change per day is flat
    let direction: 'up' | 'down' | 'flat'
    if (Math.abs(velocity) < FLAT_THRESHOLD) {
      direction = 'flat'
    } else {
      direction = velocity > 0 ? 'up' : 'down'
    }

    results.push({
      metric,
      direction,
      velocity: Math.round(velocity * 100) / 100,
      consistency: Math.round(rSquared * 1000) / 1000,
    })
  }

  return results
}
