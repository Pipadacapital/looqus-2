/**
 * Shared backfill windowing for Meta Ads and Google Ads.
 * All dates are UTC date-only (YYYY-MM-DD); store as DATE in DB.
 */

export const DEFAULT_BACKFILL_DAYS = 730
export const INCREMENTAL_SYNC_DAYS = 7

const envBackfillDays = (): number => {
  const v = process.env.ADS_BACKFILL_DAYS
  if (v != null && v !== '') {
    const n = parseInt(v, 10)
    if (!Number.isNaN(n) && n > 0) return Math.min(730, Math.max(1, n))
  }
  return DEFAULT_BACKFILL_DAYS
}

export function getBackfillDays(): number {
  return envBackfillDays()
}

export interface BackfillWindow {
  since: string
  until: string
}

/**
 * Build contiguous date windows for backfill.
 * @param startDate - start of range (inclusive), UTC date
 * @param endDate - end of range (inclusive), UTC date
 * @param chunkDays - max days per window (default 30)
 * @returns array of { since: 'YYYY-MM-DD', until: 'YYYY-MM-DD' } inclusive
 */
export function buildBackfillWindows(
  startDate: Date,
  endDate: Date,
  chunkDays = 30
): BackfillWindow[] {
  const windows: BackfillWindow[] = []
  const start = new Date(startDate)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(endDate)
  end.setUTCHours(0, 0, 0, 0)
  if (start.getTime() > end.getTime()) return windows

  let cur = new Date(start)
  while (cur.getTime() <= end.getTime()) {
    const until = new Date(cur)
    until.setUTCDate(until.getUTCDate() + chunkDays - 1)
    if (until.getTime() > end.getTime()) until.setTime(end.getTime())
    windows.push({
      since: cur.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
    })
    cur.setUTCDate(cur.getUTCDate() + chunkDays)
  }
  return windows
}

/** End date for backfill = today (UTC). */
export function backfillEndDate(): Date {
  const d = new Date()
  d.setUTCHours(23, 59, 59, 999)
  return d
}

/** Start date for backfill = today - days (UTC midnight). */
export function backfillStartDate(days: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  d.setUTCHours(0, 0, 0, 0)
  return d
}
