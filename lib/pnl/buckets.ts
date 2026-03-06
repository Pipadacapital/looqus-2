import { differenceInDays, getDaysInMonth } from 'date-fns'

export type Granularity = 'day' | 'week' | 'month' | 'quarter'

export type BucketInfo = {
  key: string
  label: string
  start: Date
  end: Date
  /** For founder salary: month of the bucket (used for days-in-month). */
  monthStart: Date
  /** Number of days in this bucket (for proration). */
  daysInBucket: number
}

/** Format a UTC date as yyyy-MM-dd from its UTC components. */
function toUtcDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Format a Date's UTC calendar day as "MMM d, yyyy" (UTC, no timezone rollover). */
function formatUtcLabel(d: Date): string {
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Return UTC date string (yyyy-MM-dd) for each UTC day in [bucket.start, bucket.end]. */
export function getBucketUtcDateStrings(bucket: BucketInfo): string[] {
  const out: string[] = []
  const cur = new Date(bucket.start.getTime())
  while (cur <= bucket.end) {
    out.push(toUtcDateKey(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate()))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/** Generate bucket boundaries for the given range and granularity. All boundaries and labels use UTC so business-day labels match the selected calendar day. */
export function getBuckets(
  fromDate: Date,
  toDate: Date,
  granularity: Granularity
): BucketInfo[] {
  const buckets: BucketInfo[] = []
  const fromY = fromDate.getUTCFullYear()
  const fromM = fromDate.getUTCMonth()
  const fromD = fromDate.getUTCDate()
  const toY = toDate.getUTCFullYear()
  const toM = toDate.getUTCMonth()
  const toD = toDate.getUTCDate()

  if (granularity === 'day') {
    let y = fromY
    let m = fromM
    let d = fromD
    for (;;) {
      const start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0))
      const end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999))
      const key = toUtcDateKey(y, m + 1, d)
      buckets.push({
        key,
        label: formatUtcLabel(start),
        start,
        end,
        monthStart: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
        daysInBucket: 1,
      })
      if (y === toY && m === toM && d === toD) break
      d += 1
      if (d > new Date(Date.UTC(y, m + 1, 0)).getUTCDate()) {
        d = 1
        m += 1
        if (m > 11) {
          m = 0
          y += 1
        }
      }
    }
  } else if (granularity === 'week') {
    // ISO week (Monday start) in UTC
    const toMonday = (date: Date) => {
      const x = new Date(date.getTime())
      const dow = x.getUTCDay()
      const back = dow === 0 ? 6 : dow - 1
      x.setUTCDate(x.getUTCDate() - back)
      x.setUTCHours(0, 0, 0, 0)
      return x
    }
    let cursor = toMonday(fromDate)
    while (cursor <= toDate) {
      const weekEnd = new Date(cursor.getTime())
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
      weekEnd.setUTCHours(23, 59, 59, 999)
      if (weekEnd >= fromDate) {
        const weekNum = getIsoWeekUtc(cursor)
        const year = cursor.getUTCFullYear()
        buckets.push({
          key: `${year}-W${String(weekNum).padStart(2, '0')}`,
          label: `Week ${weekNum}, ${year}`,
          start: new Date(cursor.getTime()),
          end: new Date(weekEnd.getTime()),
          monthStart: new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1, 0, 0, 0, 0)),
          daysInBucket: 7,
        })
      }
      cursor.setUTCDate(cursor.getUTCDate() + 7)
    }
  } else if (granularity === 'month') {
    let y = fromY
    let m = fromM
    while (y < toY || (y === toY && m <= toM)) {
      const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0))
      const lastD = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
      const end = new Date(Date.UTC(y, m, lastD, 23, 59, 59, 999))
      buckets.push({
        key: `${y}-${String(m + 1).padStart(2, '0')}`,
        label: start.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }),
        start,
        end,
        monthStart: new Date(start.getTime()),
        daysInBucket: lastD,
      })
      m += 1
      if (m > 11) {
        m = 0
        y += 1
      }
    }
  } else {
    // quarter (UTC)
    const qStart = (y: number, q: number) => new Date(Date.UTC(y, (q - 1) * 3, 1, 0, 0, 0, 0))
    const qEnd = (y: number, q: number) => {
      const last = new Date(Date.UTC(y, q * 3, 0))
      return new Date(Date.UTC(y, last.getUTCMonth(), last.getUTCDate(), 23, 59, 59, 999))
    }
    let y = fromY
    let q = Math.floor(fromM / 3) + 1
    const toQ = Math.floor(toM / 3) + 1
    while (y < toY || (y === toY && q <= toQ)) {
      const start = qStart(y, q)
      const end = qEnd(y, q)
      if (end >= fromDate && start <= toDate) {
        buckets.push({
          key: `${y}-Q${q}`,
          label: `Q${q} ${y}`,
          start,
          end,
          monthStart: new Date(start.getTime()),
          daysInBucket: differenceInDays(end, start) + 1,
        })
      }
      q += 1
      if (q > 4) {
        q = 1
        y += 1
      }
    }
  }

  // Sort latest → oldest (bucket.end descending)
  buckets.sort((a, b) => b.end.getTime() - a.end.getTime())
  return buckets
}

function getIsoWeekUtc(d: Date): number {
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const dow = jan1.getUTCDay()
  const firstMonday = new Date(jan1)
  firstMonday.setUTCDate(jan1.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  const diff = differenceInDays(d, firstMonday)
  return Math.floor(diff / 7) + 1
}

/** Allocate a monthly amount to a bucket (founder salary). Prorate by days in bucket that fall inside [rangeStart, rangeEnd]. */
export function allocateMonthlyToBucket(
  monthlyAmount: number,
  bucket: BucketInfo,
  rangeStart: Date,
  rangeEnd: Date
): number {
  const overlapStart = new Date(Math.max(bucket.start.getTime(), rangeStart.getTime()))
  const overlapEnd = new Date(Math.min(bucket.end.getTime(), rangeEnd.getTime()))
  if (overlapStart > overlapEnd) return 0
  const daysInMonth = getDaysInMonth(bucket.monthStart)
  const dailyRate = monthlyAmount / daysInMonth
  const overlapDays = differenceInDays(overlapEnd, overlapStart) + 1
  return dailyRate * overlapDays
}
