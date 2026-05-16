"""Unit tests for src/lib/date_buckets.py.

Expected outputs derived by reading the TS source
(apps/frontend/lib/pnl/buckets.ts) line-by-line.

IMPORTANT DEVIATIONS from the task spec's suggested test assertions:

1. Bucket order is NEWEST-FIRST.
   TS source line 164-166:
       // Sort latest → oldest (bucket.end descending)
       buckets.sort((a, b) => b.end.getTime() - a.end.getTime())
   Therefore buckets[0] is the LAST bucket, not the first.
   All assertions use buckets[-1] for the oldest and buckets[0] for newest.

2. allocate_monthly_to_bucket requires range_start + range_end parameters.
   TS signature (line 179-192):
       allocateMonthlyToBucket(monthlyAmount, bucket, rangeStart, rangeEnd)
   The overlap is clamped to [rangeStart, rangeEnd]. Tests pass the full
   period as range so the overlap equals the full bucket.

If a test fails, the Python port deviates from TS — DO NOT change the test;
fix the port.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from src.lib.date_buckets import (
    Granularity,
    allocate_monthly_to_bucket,
    get_bucket_utc_date_strings,
    get_buckets,
)


# ---------------------------------------------------------------------------
# get_buckets — day granularity
# ---------------------------------------------------------------------------

def test_get_buckets_day_one_week():
    """7-day range produces 7 buckets; newest-first so [-1] is oldest."""
    buckets = get_buckets(date(2024, 1, 1), date(2024, 1, 7), Granularity.DAY)
    assert len(buckets) == 7
    # TS sorts newest→oldest (line 165), so index -1 is the earliest bucket
    assert buckets[-1].key == "2024-01-01"
    assert buckets[0].key == "2024-01-07"


def test_get_buckets_day_single():
    buckets = get_buckets(date(2024, 3, 15), date(2024, 3, 15), Granularity.DAY)
    assert len(buckets) == 1
    assert buckets[0].key == "2024-03-15"


def test_get_buckets_day_crosses_month():
    """Jan 30 – Feb 2 crosses a month boundary."""
    buckets = get_buckets(date(2024, 1, 30), date(2024, 2, 2), Granularity.DAY)
    assert len(buckets) == 4
    keys = [b.key for b in buckets]
    # newest-first
    assert keys == ["2024-02-02", "2024-02-01", "2024-01-31", "2024-01-30"]


def test_get_buckets_day_crosses_year():
    buckets = get_buckets(date(2023, 12, 31), date(2024, 1, 1), Granularity.DAY)
    assert len(buckets) == 2
    assert buckets[0].key == "2024-01-01"
    assert buckets[1].key == "2023-12-31"


# ---------------------------------------------------------------------------
# get_buckets — month granularity
# ---------------------------------------------------------------------------

def test_get_buckets_month_q1():
    """Q1 2024 produces 3 monthly buckets, newest-first."""
    buckets = get_buckets(date(2024, 1, 1), date(2024, 3, 31), Granularity.MONTH)
    # newest-first
    assert [b.key for b in buckets] == ["2024-03", "2024-02", "2024-01"]


def test_get_buckets_month_single():
    buckets = get_buckets(date(2024, 5, 1), date(2024, 5, 31), Granularity.MONTH)
    assert len(buckets) == 1
    assert buckets[0].key == "2024-05"


def test_get_buckets_month_days_in_bucket():
    """January has 31 days; daysInBucket must reflect that."""
    buckets = get_buckets(date(2024, 1, 1), date(2024, 1, 31), Granularity.MONTH)
    assert buckets[0].days_in_bucket == 31


def test_get_buckets_month_february_leap():
    """February 2024 is a leap year — 29 days."""
    buckets = get_buckets(date(2024, 2, 1), date(2024, 2, 29), Granularity.MONTH)
    assert buckets[0].days_in_bucket == 29


# ---------------------------------------------------------------------------
# get_buckets — quarter granularity
# ---------------------------------------------------------------------------

def test_get_buckets_quarter_h1():
    """H1 2024 produces Q1 + Q2, newest-first."""
    buckets = get_buckets(date(2024, 1, 1), date(2024, 6, 30), Granularity.QUARTER)
    # newest-first
    assert [b.key for b in buckets] == ["2024-Q2", "2024-Q1"]


def test_get_buckets_quarter_single():
    buckets = get_buckets(date(2024, 4, 1), date(2024, 6, 30), Granularity.QUARTER)
    assert len(buckets) == 1
    assert buckets[0].key == "2024-Q2"


def test_get_buckets_quarter_days_in_bucket():
    """Q1 2024: Jan(31) + Feb(29 leap) + Mar(31) = 91 days."""
    buckets = get_buckets(date(2024, 1, 1), date(2024, 3, 31), Granularity.QUARTER)
    assert buckets[0].days_in_bucket == 91


# ---------------------------------------------------------------------------
# get_bucket_utc_date_strings
# ---------------------------------------------------------------------------

def test_get_bucket_utc_date_strings_day():
    """For a single-day bucket, returns just that day's ISO string."""
    bucket = get_buckets(date(2024, 1, 15), date(2024, 1, 15), Granularity.DAY)[0]
    assert get_bucket_utc_date_strings(bucket) == ["2024-01-15"]


def test_get_bucket_utc_date_strings_month():
    """January 2024 monthly bucket spans 31 days."""
    bucket = get_buckets(date(2024, 1, 1), date(2024, 1, 31), Granularity.MONTH)[0]
    strings = get_bucket_utc_date_strings(bucket)
    assert len(strings) == 31
    assert strings[0] == "2024-01-01"
    assert strings[-1] == "2024-01-31"


def test_get_bucket_utc_date_strings_quarter():
    """Q2 2024: Apr(30) + May(31) + Jun(30) = 91 days."""
    bucket = get_buckets(date(2024, 4, 1), date(2024, 6, 30), Granularity.QUARTER)[0]
    strings = get_bucket_utc_date_strings(bucket)
    assert len(strings) == 91
    assert strings[0] == "2024-04-01"
    assert strings[-1] == "2024-06-30"


# ---------------------------------------------------------------------------
# allocate_monthly_to_bucket
# ---------------------------------------------------------------------------

def test_allocate_monthly_to_bucket_full_month():
    """A monthly cost of 3100 over a 31-day month, allocated to a 31-day
    bucket (the whole month) with range covering the whole month, is 3100.

    TS: daysInMonth = getDaysInMonth(bucket.monthStart) = 31
        dailyRate = 3100 / 31 = 100
        overlapDays = differenceInDays(end, start) + 1 = 31
        result = 100 * 31 = 3100
    """
    bucket = get_buckets(date(2024, 1, 1), date(2024, 1, 31), Granularity.MONTH)[0]
    range_start = datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    range_end = datetime(2024, 1, 31, 23, 59, 59, tzinfo=timezone.utc)
    result = allocate_monthly_to_bucket(
        monthly_amount=3100.0,
        bucket=bucket,
        range_start=range_start,
        range_end=range_end,
    )
    assert result == 3100.0


def test_allocate_monthly_to_bucket_partial():
    """A monthly cost of 3100 allocated to a 1-day bucket within January is
    3100/31 = 100.

    TS: daysInMonth = getDaysInMonth(bucket.monthStart) = 31
        dailyRate = 3100 / 31 = 100
        overlapDays = differenceInDays(end, start) + 1 = 1
        result = 100 * 1 = 100
    """
    bucket = get_buckets(date(2024, 1, 5), date(2024, 1, 5), Granularity.DAY)[0]
    # range covers all of January so the overlap is just this 1-day bucket
    range_start = datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    range_end = datetime(2024, 1, 31, 23, 59, 59, tzinfo=timezone.utc)
    result = allocate_monthly_to_bucket(
        monthly_amount=3100.0,
        bucket=bucket,
        range_start=range_start,
        range_end=range_end,
    )
    assert abs(result - 100.0) < 0.0001


def test_allocate_monthly_to_bucket_no_overlap():
    """When the range doesn't overlap the bucket, result is 0.

    TS: overlapStart > overlapEnd → return 0
    """
    bucket = get_buckets(date(2024, 1, 1), date(2024, 1, 31), Granularity.MONTH)[0]
    # range is entirely in February — no overlap with January bucket
    range_start = datetime(2024, 2, 1, 0, 0, 0, tzinfo=timezone.utc)
    range_end = datetime(2024, 2, 29, 23, 59, 59, tzinfo=timezone.utc)
    result = allocate_monthly_to_bucket(
        monthly_amount=3100.0,
        bucket=bucket,
        range_start=range_start,
        range_end=range_end,
    )
    assert result == 0.0


def test_allocate_monthly_to_bucket_partial_overlap():
    """Range starts mid-month. Bucket is all of January; range starts Jan 16.
    Overlap = Jan 16–31 = 16 days. daysInMonth = 31.
    Result = 3100/31 * 16 = 1600.
    """
    bucket = get_buckets(date(2024, 1, 1), date(2024, 1, 31), Granularity.MONTH)[0]
    range_start = datetime(2024, 1, 16, 0, 0, 0, tzinfo=timezone.utc)
    range_end = datetime(2024, 1, 31, 23, 59, 59, tzinfo=timezone.utc)
    result = allocate_monthly_to_bucket(
        monthly_amount=3100.0,
        bucket=bucket,
        range_start=range_start,
        range_end=range_end,
    )
    # 3100/31 * 16 = 100 * 16 = 1600
    assert abs(result - 1600.0) < 0.0001
