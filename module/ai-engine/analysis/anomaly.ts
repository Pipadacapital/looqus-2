export type Anomaly = {
  date: string
  metric: string
  value: number
  zScore: number
  direction: 'high' | 'low'
}

/**
 * Z-score anomaly detection on a daily time series.
 * Flags days where a metric deviates more than `threshold` standard deviations from the mean.
 * Returns top `maxResults` anomalies sorted by |z-score| descending.
 */
export function detectAnomalies(
  daily: Array<Record<string, number | string | null | undefined>>,
  metrics: string[],
  threshold = 2.0,
  maxResults = 5
): Anomaly[] {
  if (daily.length < 3) return []

  const anomalies: Anomaly[] = []

  for (const metric of metrics) {
    const values: number[] = []
    for (const row of daily) {
      const val = row[metric]
      if (typeof val === 'number' && !isNaN(val)) {
        values.push(val)
      }
    }

    if (values.length < 3) continue

    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
    const stddev = Math.sqrt(variance)

    if (stddev === 0) continue

    for (const row of daily) {
      const val = row[metric]
      if (typeof val !== 'number' || isNaN(val)) continue

      const zScore = (val - mean) / stddev
      if (Math.abs(zScore) > threshold) {
        anomalies.push({
          date: String(row.date ?? ''),
          metric,
          value: val,
          zScore: Math.round(zScore * 100) / 100,
          direction: zScore > 0 ? 'high' : 'low',
        })
      }
    }
  }

  anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
  return anomalies.slice(0, maxResults)
}
