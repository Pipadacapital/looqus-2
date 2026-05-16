"""Date bucketing — port of apps/frontend/lib/pnl/buckets.ts.

Porting notes:
- All boundary construction uses UTC (timezone.utc) to match TS Date.UTC(...)
- getBuckets sorts newest→oldest (TS line 165); Python preserves that ordering
- BucketInfo.monthStart / daysInBucket fields are both ported
- allocateMonthlyToBucket takes rangeStart + rangeEnd (clamping params)
- ISO week numbering matches the TS getIsoWeekUtc() helper (Monday-start)
- date-fns differenceInDays(a, b) = (a - b).days — calendar-day difference
- date-fns getDaysInMonth(d) = calendar.monthrange(y, m)[1]
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from enum import Enum


class Granularity(str, Enum):
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    QUARTER = "quarter"


@dataclass(frozen=True)
class Bucket:
    key: str          # canonical key e.g. "2024-01-15", "2024-01", "2024-Q1"
    label: str        # human label matching TS output
    start_date: date  # inclusive calendar date (UTC)
    end_date: date    # inclusive calendar date (UTC)
    # Extra fields ported from BucketInfo — used by allocate_monthly_to_bucket
    # and pnl.py per-bucket math.
    month_start: date   # first day of the bucket's month (for daysInMonth)
    days_in_bucket: int  # number of days in this bucket


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _to_utc_date_key(y: int, m: int, d: int) -> str:
    """Format as yyyy-MM-dd from UTC components. Port of TS toUtcDateKey()."""
    return f"{y}-{m:02d}-{d:02d}"


def _format_utc_label_day(d: date) -> str:
    """Format a UTC calendar date as 'MMM D, YYYY'.

    TS: d.toLocaleDateString('en-US', { timeZone:'UTC', month:'short',
            day:'numeric', year:'numeric' })
    Examples: "Jan 1, 2024", "Dec 31, 2023"
    """
    _MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{_MONTHS[d.month - 1]} {d.day}, {d.year}"


def _format_utc_label_month(d: date) -> str:
    """Format a UTC month as 'Mon YYYY'.

    TS: start.toLocaleDateString('en-US', { timeZone:'UTC', month:'short',
            year:'numeric' })
    Examples: "Jan 2024"
    """
    _MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{_MONTHS[d.month - 1]} {d.year}"


def _days_in_month(y: int, m: int) -> int:
    """Port of date-fns getDaysInMonth(). Uses Python calendar module."""
    return calendar.monthrange(y, m)[1]


def _difference_in_days(a: datetime, b: datetime) -> int:
    """Port of date-fns differenceInDays(a, b) = floor((a - b) / 1 day).

    date-fns computes this by truncating to whole days. When both datetimes
    are UTC midnight-aligned this is exact; for non-midnight values it floors.
    We receive UTC boundary datetimes (T00:00:00 or T23:59:59.999) so we
    strip to date before differencing to match the TS integer result.
    """
    return (a.date() - b.date()).days


def _to_monday(d: date) -> date:
    """Return the Monday of the ISO week containing d (UTC, Monday-start).

    TS toMonday(): dow=0 (Sun)→back 6, else back (dow-1).
    Python weekday(): Mon=0 … Sun=6; isoweekday(): Mon=1 … Sun=7.
    """
    dow = d.isoweekday()  # Mon=1 … Sun=7
    back = 6 if dow == 7 else dow - 1
    return d - timedelta(days=back)


def _get_iso_week_utc(d: date) -> int:
    """Port of TS getIsoWeekUtc().

    TS:
        jan1 = Date.UTC(year, 0, 1)
        dow  = jan1.getUTCDay()  // 0=Sun … 6=Sat
        firstMonday = jan1 + (dow===0 ? -6 : 1-dow) days
        diff = differenceInDays(d, firstMonday)
        return floor(diff / 7) + 1
    """
    jan1 = date(d.year, 1, 1)
    dow = jan1.isoweekday() % 7  # convert Mon=1…Sun=7 → Sun=0…Sat=6
    offset = -6 if dow == 0 else (1 - dow)
    first_monday = jan1 + timedelta(days=offset)
    diff = (d - first_monday).days
    return diff // 7 + 1


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_buckets(from_date: date, to_date: date, granularity: Granularity) -> list[Bucket]:
    """Mirror lib/pnl/buckets.ts::getBuckets.

    Produces Bucket instances spanning [from_date, to_date] at the given
    granularity. Result is sorted NEWEST-FIRST (TS line 165).
    """
    buckets: list[Bucket] = []

    if granularity == Granularity.DAY:
        cur = from_date
        while cur <= to_date:
            key = _to_utc_date_key(cur.year, cur.month, cur.day)
            buckets.append(Bucket(
                key=key,
                label=_format_utc_label_day(cur),
                start_date=cur,
                end_date=cur,
                month_start=cur.replace(day=1),
                days_in_bucket=1,
            ))
            cur += timedelta(days=1)

    elif granularity == Granularity.WEEK:
        # ISO week, Monday-start (UTC)
        cursor = _to_monday(from_date)
        while cursor <= to_date:
            week_end = cursor + timedelta(days=6)
            if week_end >= from_date:
                week_num = _get_iso_week_utc(cursor)
                year = cursor.year
                buckets.append(Bucket(
                    key=f"{year}-W{week_num:02d}",
                    label=f"Week {week_num}, {year}",
                    start_date=cursor,
                    end_date=week_end,
                    month_start=cursor.replace(day=1),
                    days_in_bucket=7,
                ))
            cursor += timedelta(days=7)

    elif granularity == Granularity.MONTH:
        y, m = from_date.year, from_date.month
        to_y, to_m = to_date.year, to_date.month
        while (y, m) <= (to_y, to_m):
            last_d = _days_in_month(y, m)
            start = date(y, m, 1)
            end = date(y, m, last_d)
            buckets.append(Bucket(
                key=f"{y}-{m:02d}",
                label=_format_utc_label_month(start),
                start_date=start,
                end_date=end,
                month_start=start,
                days_in_bucket=last_d,
            ))
            m += 1
            if m > 12:
                m = 1
                y += 1

    else:  # QUARTER
        def q_start(y: int, q: int) -> date:
            return date(y, (q - 1) * 3 + 1, 1)

        def q_end(y: int, q: int) -> date:
            # TS: new Date(Date.UTC(y, q*3, 0)) — day 0 of month q*3+1 = last
            # day of month q*3. In Python: last day of month (q*3).
            last_month = q * 3
            last_day = _days_in_month(y, last_month)
            return date(y, last_month, last_day)

        def q_days(y: int, q: int) -> int:
            """date-fns differenceInDays(end, start) + 1 for the quarter."""
            qs = q_start(y, q)
            qe = q_end(y, q)
            return (qe - qs).days + 1

        y = from_date.year
        q = (from_date.month - 1) // 3 + 1
        to_y = to_date.year
        to_q = (to_date.month - 1) // 3 + 1

        while (y, q) <= (to_y, to_q):
            qs = q_start(y, q)
            qe = q_end(y, q)
            # TS filters: end >= fromDate && start <= toDate
            if qe >= from_date and qs <= to_date:
                buckets.append(Bucket(
                    key=f"{y}-Q{q}",
                    label=f"Q{q} {y}",
                    start_date=qs,
                    end_date=qe,
                    month_start=qs,
                    days_in_bucket=q_days(y, q),
                ))
            q += 1
            if q > 4:
                q = 1
                y += 1

    # Sort latest → oldest (TS line 164-166: buckets.sort((a,b)=>b.end-a.end))
    buckets.sort(key=lambda b: b.end_date, reverse=True)
    return buckets


def get_bucket_utc_date_strings(bucket: Bucket) -> list[str]:
    """Mirror lib/pnl/buckets.ts::getBucketUtcDateStrings.

    Returns every YYYY-MM-DD string the bucket spans (inclusive).
    """
    out: list[str] = []
    cur = bucket.start_date
    while cur <= bucket.end_date:
        out.append(_to_utc_date_key(cur.year, cur.month, cur.day))
        cur += timedelta(days=1)
    return out


def allocate_monthly_to_bucket(
    monthly_amount: float,
    bucket: Bucket,
    range_start: datetime,
    range_end: datetime,
) -> float:
    """Mirror lib/pnl/buckets.ts::allocateMonthlyToBucket.

    Allocates a monthly cost to a (possibly sub-month) bucket by prorating
    the overlap of [bucket.start, bucket.end] ∩ [range_start, range_end].

    TS:
        overlapStart = max(bucket.start, rangeStart)
        overlapEnd   = min(bucket.end,   rangeEnd)
        if overlapStart > overlapEnd: return 0
        daysInMonth  = getDaysInMonth(bucket.monthStart)
        dailyRate    = monthlyAmount / daysInMonth
        overlapDays  = differenceInDays(overlapEnd, overlapStart) + 1
        return dailyRate * overlapDays

    NOTE: range_start / range_end are timezone-aware UTC datetimes matching
    the route's fromDate / toDate (T00:00:00.000Z / T23:59:59.999Z).
    We convert bucket boundaries to UTC midnight for the max/min comparison.
    """
    bucket_start_dt = datetime(
        bucket.start_date.year, bucket.start_date.month, bucket.start_date.day,
        0, 0, 0, tzinfo=timezone.utc,
    )
    bucket_end_dt = datetime(
        bucket.end_date.year, bucket.end_date.month, bucket.end_date.day,
        23, 59, 59, 999000, tzinfo=timezone.utc,
    )

    overlap_start = max(bucket_start_dt, range_start)
    overlap_end = min(bucket_end_dt, range_end)

    if overlap_start > overlap_end:
        return 0.0

    days_in_month = _days_in_month(bucket.month_start.year, bucket.month_start.month)
    daily_rate = monthly_amount / days_in_month
    # differenceInDays(overlapEnd, overlapStart) + 1
    overlap_days = _difference_in_days(overlap_end, overlap_start) + 1
    return daily_rate * overlap_days
