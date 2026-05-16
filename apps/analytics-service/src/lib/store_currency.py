"""Resolve the workspace's Shopify store currency.

Port of apps/frontend/lib/shopify/store-currency.ts::getShopifyStoreCurrency.

Priority (mirrors TS lines 32-53):
    1. Most-recent order currency within the date range (shopify_orders filtered by connectionId + processedAt range)
    2. Most-recent analytics daily currency within the date range (shopify_analytics_daily filtered by connectionId + date range)
    3. Most-recent order currency overall (no date filter)
    4. Most-recent analytics daily currency overall (no date filter)
    5. fallback (default 'USD')

The TS function takes a Prisma client + connectionId (not workspaceId directly).
The Python port takes an asyncpg Connection + connection_id, firing 4 concurrent
SQL queries (using asyncio.gather — equivalent to Promise.all).

TS table names via Prisma:
    ShopifyOrder          → shopify_orders
    ShopifyAnalyticsDaily → shopify_analytics_daily

Columns used:
    shopify_orders:           connection_id, processed_at, currency
    shopify_analytics_daily:  connection_id, date, currency
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime
from typing import Optional

import asyncpg


async def get_shopify_store_currency(
    conn: asyncpg.Connection,
    connection_id: str,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    fallback: str = "USD",
) -> str:
    """Returns the ISO currency code for the workspace's primary Shopify store.

    Falls back to `fallback` ('USD' by default) if no store is connected or
    no orders/analytics rows exist — same behaviour as the TS source.

    Args:
        conn:          asyncpg database connection.
        connection_id: ShopifyConnection.id (NOT workspace id).
        from_date:     Optional range start (inclusive). When provided along
                       with to_date, limits priority-1 and priority-2 lookups.
        to_date:       Optional range end (inclusive).
        fallback:      Currency code to return when no result is found.

    TS mapping:
        connectionId   → connection_id
        options.fromDate / options.toDate → from_date / to_date
        prisma.shopifyOrder.findFirst(...orderBy processedAt desc)  → ORDER BY processed_at DESC LIMIT 1
        prisma.shopifyAnalyticsDaily.findFirst(...orderBy date desc) → ORDER BY date DESC LIMIT 1
    """
    if not connection_id:
        return fallback

    # Build date range WHERE fragments if range provided (both must be present).
    has_range = from_date is not None and to_date is not None

    # TS: rangeWhere = { processedAt: { gte: fromDate, lte: toDate } }
    # TS: dailyRangeWhere = { date: { gte: fromDate, lte: toDate } }
    # We run 4 queries in parallel (mirror of Promise.all in TS).

    async def _order_in_range() -> Optional[str]:
        if not has_range:
            return None
        row = await conn.fetchrow(
            """
            SELECT currency
            FROM shopify_orders
            WHERE connection_id = $1
              AND processed_at >= $2
              AND processed_at <= $3
            ORDER BY processed_at DESC
            LIMIT 1
            """,
            connection_id,
            datetime(from_date.year, from_date.month, from_date.day, 0, 0, 0),  # type: ignore[union-attr]
            datetime(to_date.year, to_date.month, to_date.day, 23, 59, 59),     # type: ignore[union-attr]
        )
        return row["currency"] if row else None

    async def _daily_in_range() -> Optional[str]:
        if not has_range:
            return None
        row = await conn.fetchrow(
            """
            SELECT currency
            FROM shopify_analytics_daily
            WHERE connection_id = $1
              AND date >= $2
              AND date <= $3
            ORDER BY date DESC
            LIMIT 1
            """,
            connection_id,
            from_date,
            to_date,
        )
        return row["currency"] if row else None

    async def _latest_order() -> Optional[str]:
        row = await conn.fetchrow(
            """
            SELECT currency
            FROM shopify_orders
            WHERE connection_id = $1
            ORDER BY processed_at DESC
            LIMIT 1
            """,
            connection_id,
        )
        return row["currency"] if row else None

    async def _latest_daily() -> Optional[str]:
        row = await conn.fetchrow(
            """
            SELECT currency
            FROM shopify_analytics_daily
            WHERE connection_id = $1
            ORDER BY date DESC
            LIMIT 1
            """,
            connection_id,
        )
        return row["currency"] if row else None

    # Mirror TS Promise.all — run all 4 in parallel.
    order_in_range, daily_in_range, latest_order, latest_daily = await asyncio.gather(
        _order_in_range(),
        _daily_in_range(),
        _latest_order(),
        _latest_daily(),
    )

    # TS priority chain (lines 55-61):
    #   orderInRange?.currency?.trim() || dailyInRange?.currency?.trim() ||
    #   latestOrder?.currency?.trim()  || latestDaily?.currency?.trim()  || fallback
    def _clean(val: Optional[str]) -> str:
        return val.strip() if val and val.strip() else ""

    return (
        _clean(order_in_range)
        or _clean(daily_in_range)
        or _clean(latest_order)
        or _clean(latest_daily)
        or fallback
    )
