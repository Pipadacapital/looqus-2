"""P&L computation — port of apps/frontend/app/api/workspaces/[slug]/pnl/route.ts.

Phase 5 SP-1, Task 11.

Public API:
    compute_pnl(conn, request) -> PnLResponse

WooCommerce branches:
    When workspace.platform == 'WOOCOMMERCE', this function returns an empty
    PnLResponse. WooCommerce support is deferred to a later sub-project.
    Each deferred branch is marked # TODO: WooCommerce.

Decimal → float:
    asyncpg returns Decimal for NUMERIC columns. All such values are coerced to
    float() at the query boundary (inside _fetch_* helpers) so the per-bucket
    math never touches Decimal objects — consistent with TS's Number() coercion.

pgbouncer:
    All queries use conn directly (acquired from pool with statement_cache_size=0
    set at pool-init time). Do not use conn.prepare() — pgbouncer transaction mode
    does not support named prepared statements.
"""
from __future__ import annotations

import calendar
import json
from datetime import date, datetime, timezone
from typing import Any

import asyncpg

from src.grpc.gen.analytics import metrics_pb2
from src.lib.cogs import (
    LineItemWithDate,
    compute_line_items_cogs,
    normalize_cogs_settings,
)
from src.lib.currency import convert_currency
from src.lib.date_buckets import (
    Granularity,
    allocate_monthly_to_bucket,
    get_bucket_utc_date_strings,
    get_buckets,
)
from src.lib.order_filters import (
    has_no_order_filters,
    normalize_order_filter_settings,
)
from src.lib.shiprocket_charges import total_charges_from_raw
from src.lib.workspace_costs import get_daily_variable_contribution_from_dict

# ---------------------------------------------------------------------------
# Granularity mapping: proto enum → Python Granularity
# ---------------------------------------------------------------------------

_PROTO_TO_GRANULARITY = {
    metrics_pb2.GRANULARITY_DAY: Granularity.DAY,
    metrics_pb2.GRANULARITY_WEEK: Granularity.WEEK,
    metrics_pb2.GRANULARITY_MONTH: Granularity.MONTH,
    metrics_pb2.GRANULARITY_QUARTER: Granularity.QUARTER,
}

_EMPTY_RESPONSE = metrics_pb2.PnLResponse(rows=[], currency="USD")


# ---------------------------------------------------------------------------
# Internal: SQL WHERE fragment helpers
# ---------------------------------------------------------------------------

def _build_order_inclusion_conditions(
    settings_dict: dict,
    table_alias: str,
    params: list,
    base_param_count: int = 3,
) -> str:
    """Build SQL conditions for order inclusion/exclusion filters.

    Mirrors TS getOrderInclusionWhereFromWorkspace result applied in Prisma.
    Returns a SQL fragment (may be empty string) and mutates params list.

    Args:
        settings_dict:    {"skipped_tags": list[str], "skip_zero_sales": bool}
        table_alias:      e.g. "so" for shopify_orders alias
        params:           mutable list of EXTRA query parameters (appended in place)
        base_param_count: number of fixed positional params before extras (default 3)
                          allOrders query: $1=conn, $2=from, $3=to → base=3
                          lineitems query: $1=conn, $2=conn, $3=from, $4=to → base=4
                          filteredDaily:   $1=conn, $2=from, $3=to → base=3
    """
    conditions = []
    skipped_tags: list[str] = settings_dict.get("skipped_tags", [])
    skip_zero: bool = settings_dict.get("skip_zero_sales", False)

    if skipped_tags:
        # Exclude orders whose tags overlap with any skipped tag.
        # TS Prisma: NOT (tags contains any skipped tag) - implemented as
        # NOT (tags && ARRAY[...]) using Postgres array overlap.
        # shopify_orders.tags is a TEXT[] column.
        idx = base_param_count + len(params) + 1
        params.append(skipped_tags)
        conditions.append(f"NOT ({table_alias}.tags && ${idx}::text[])")

    if skip_zero:
        conditions.append(f"{table_alias}.total_price > 0")

    if not conditions:
        return ""
    return " AND " + " AND ".join(conditions)


# ---------------------------------------------------------------------------
# Internal: data fetch helpers (each mirrors one Promise.all slot)
# ---------------------------------------------------------------------------

async def _fetch_workspace(conn: asyncpg.Connection, workspace_id: str) -> dict | None:
    """Fetch workspace row + related connections (§3).

    Returns a dict with all fields needed for PnL, or None if not found.
    """
    row = await conn.fetchrow(
        """
        SELECT
            w.id, w.slug, w.platform,
            w.founder_salary_monthly,
            w.founder_salary_currency,
            w.skip_zero_sales_orders,
            w.skipped_shopify_order_tags,
            w.features
        FROM workspaces w
        WHERE w.id = $1
        """,
        workspace_id,
    )
    if not row:
        return None
    return dict(row)


async def _fetch_shopify_connection(conn: asyncpg.Connection, workspace_id: str) -> dict | None:
    """Fetch the first CONNECTED shopify connection for a workspace."""
    row = await conn.fetchrow(
        """
        SELECT id, status
        FROM shopify_connections
        WHERE workspace_id = $1 AND status = 'CONNECTED'
        LIMIT 1
        """,
        workspace_id,
    )
    return dict(row) if row else None


async def _fetch_cogs_settings(conn: asyncpg.Connection, workspace_id: str) -> dict | None:
    """Fetch workspace_cogs_settings row."""
    row = await conn.fetchrow(
        """
        SELECT override_all_cogs_percent, fallback_cogs_percent, cogs_markup_percent
        FROM workspace_cogs_settings
        WHERE workspace_id = $1
        LIMIT 1
        """,
        workspace_id,
    )
    if not row:
        return None
    return {
        "override_all_cogs_percent": float(row["override_all_cogs_percent"] or 0),
        "fallback_cogs_percent": float(row["fallback_cogs_percent"] or 0),
        "cogs_markup_percent": float(row["cogs_markup_percent"] or 0),
    }


async def _fetch_meta_ads_connection(conn: asyncpg.Connection, workspace_id: str) -> dict | None:
    """Fetch meta_ads_connections row for workspace."""
    row = await conn.fetchrow(
        """
        SELECT id, selected_ad_account_id, selected_ad_account_ids
        FROM meta_ads_connections
        WHERE workspace_id = $1
        LIMIT 1
        """,
        workspace_id,
    )
    return dict(row) if row else None


async def _fetch_google_ads_connection(conn: asyncpg.Connection, workspace_id: str) -> dict | None:
    """Fetch google_ads_connections row for workspace."""
    row = await conn.fetchrow(
        """
        SELECT id, selected_customer_id, selected_customer_ids
        FROM google_ads_connections
        WHERE workspace_id = $1
        LIMIT 1
        """,
        workspace_id,
    )
    return dict(row) if row else None


async def _fetch_shiprocket_connection(conn: asyncpg.Connection, workspace_id: str) -> dict | None:
    """Fetch shiprocket connection (id + status) for workspace."""
    row = await conn.fetchrow(
        """
        SELECT id, status
        FROM shiprocket_connections
        WHERE workspace_id = $1
        LIMIT 1
        """,
        workspace_id,
    )
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Promise.all slot implementations (§4)
# ---------------------------------------------------------------------------

async def _fetch_daily_analytics(
    conn: asyncpg.Connection,
    connection_id: str,
    from_date: date,
    to_date: date,
) -> list[dict]:
    """§4.1 shopify_analytics_daily rows in range, ASC by date."""
    rows = await conn.fetch(
        """
        SELECT date, net_sales, gross_sales, total_tax, total_discount,
               orders_count, currency, total_returns, returns
        FROM shopify_analytics_daily
        WHERE connection_id = $1
          AND date >= $2
          AND date <= $3
        ORDER BY date ASC
        """,
        connection_id,
        from_date,
        to_date,
    )
    return [
        {
            "date": r["date"],                                  # date object
            "netSales": float(r["net_sales"] or 0),
            "grossSales": float(r["gross_sales"] or 0),
            "totalTax": float(r["total_tax"] or 0),
            "totalDiscount": float(r["total_discount"] or 0),
            "ordersCount": int(r["orders_count"] or 0),
            "currency": r["currency"] or "USD",
            "total_returns": float(r["total_returns"] or 0),
            "returns": float(r["returns"] or 0),
        }
        for r in rows
    ]


async def _fetch_workspace_costs(
    conn: asyncpg.Connection,
    workspace_id: str,
    to_date: date,
) -> list[dict]:
    """§4.2 workspace_costs where effectiveFrom <= toDate."""
    rows = await conn.fetch(
        """
        SELECT id, cost_type, amount, currency, is_percent, billing_mode,
               effective_from, effective_to
        FROM workspace_costs
        WHERE workspace_id = $1
          AND effective_from <= $2
        """,
        workspace_id,
        to_date,
    )
    return [
        {
            "costType": r["cost_type"],
            "amount": float(r["amount"] or 0),
            "currency": r["currency"],
            "isPercent": bool(r["is_percent"]),
            "billingMode": r["billing_mode"],
            "effectiveFrom": r["effective_from"],   # date object
            "effectiveTo": r["effective_to"],        # date object or None
        }
        for r in rows
    ]


async def _fetch_misc_expenses(
    conn: asyncpg.Connection,
    workspace_id: str,
    to_date: date,
) -> list[dict]:
    """§4.3 workspace_misc_expenses where effectiveStartDate <= toDate."""
    rows = await conn.fetch(
        """
        SELECT id, amount, currency, effective_start_date
        FROM workspace_misc_expenses
        WHERE workspace_id = $1
          AND effective_start_date <= $2
        """,
        workspace_id,
        to_date,
    )
    return [
        {
            "amount": float(r["amount"] or 0),
            "currency": r["currency"] or "INR",
            "effectiveStartDate": r["effective_start_date"],  # date object
        }
        for r in rows
    ]


async def _fetch_products(
    conn: asyncpg.Connection,
    connection_id: str,
) -> dict[str, float]:
    """§4.4 Build coq_map: shopifyId → coq (float). Only entries where coq IS NOT NULL."""
    rows = await conn.fetch(
        """
        SELECT shopify_id, coq
        FROM shopify_products
        WHERE connection_id = $1
          AND coq IS NOT NULL
        """,
        connection_id,
    )
    return {r["shopify_id"]: float(r["coq"]) for r in rows}


async def _fetch_line_items(
    conn: asyncpg.Connection,
    connection_id: str,
    from_date: datetime,
    to_date: datetime,
    order_inclusion_conditions: str,
    params_prefix: list,
) -> list[dict]:
    """§4.5 shopify_line_items joined to shopify_orders for date + order filters.

    Returns list of dicts with: product_shopify_id, quantity, price, order_processed_at.
    """
    # Base params: connection_id (x2), from_date, to_date
    params = [connection_id, connection_id, from_date, to_date] + params_prefix

    sql = f"""
        SELECT sli.product_shopify_id, sli.quantity, sli.price,
               so.processed_at AS order_processed_at
        FROM shopify_line_items sli
        JOIN shopify_orders so ON so.id = sli.order_id
        WHERE sli.connection_id = $1
          AND so.connection_id = $2
          AND so.processed_at >= $3
          AND so.processed_at <= $4
          {order_inclusion_conditions}
    """
    rows = await conn.fetch(sql, *params)
    return [
        {
            "product_shopify_id": r["product_shopify_id"],
            "quantity": int(r["quantity"] or 0),
            "price": float(r["price"] or 0),
            "order_processed_at": r["order_processed_at"],  # datetime
        }
        for r in rows
    ]


async def _fetch_meta_ad_daily(
    conn: asyncpg.Connection,
    meta_conn: dict,
    from_date: date,
    to_date: date,
) -> list[dict]:
    """§4.6 meta_ads_daily_metrics with optional ad_account_id filter."""
    if not meta_conn:
        return []

    selected_ids: list[str] = meta_conn.get("selected_ad_account_ids") or []
    selected_id: str | None = meta_conn.get("selected_ad_account_id")
    conn_id = meta_conn["id"]

    if selected_ids:
        rows = await conn.fetch(
            """
            SELECT date, spend
            FROM meta_ads_daily_metrics
            WHERE connection_id = $1
              AND date >= $2
              AND date <= $3
              AND ad_account_id = ANY($4::text[])
            """,
            conn_id, from_date, to_date, selected_ids,
        )
    elif selected_id:
        rows = await conn.fetch(
            """
            SELECT date, spend
            FROM meta_ads_daily_metrics
            WHERE connection_id = $1
              AND date >= $2
              AND date <= $3
              AND ad_account_id = $4
            """,
            conn_id, from_date, to_date, selected_id,
        )
    else:
        rows = await conn.fetch(
            """
            SELECT date, spend
            FROM meta_ads_daily_metrics
            WHERE connection_id = $1
              AND date >= $2
              AND date <= $3
            """,
            conn_id, from_date, to_date,
        )

    return [{"date": r["date"], "spend": float(r["spend"] or 0)} for r in rows]


async def _fetch_google_ad_daily(
    conn: asyncpg.Connection,
    google_conn: dict,
    from_date: date,
    to_date: date,
) -> list[dict]:
    """§4.7 google_ads_daily_metrics with optional customer_id filter."""
    if not google_conn:
        return []

    selected_ids: list[str] = google_conn.get("selected_customer_ids") or []
    selected_id: str | None = google_conn.get("selected_customer_id")
    conn_id = google_conn["id"]

    if selected_ids:
        rows = await conn.fetch(
            """
            SELECT date, spend
            FROM google_ads_daily_metrics
            WHERE connection_id = $1
              AND date >= $2
              AND date <= $3
              AND customer_id = ANY($4::text[])
            """,
            conn_id, from_date, to_date, selected_ids,
        )
    elif selected_id:
        rows = await conn.fetch(
            """
            SELECT date, spend
            FROM google_ads_daily_metrics
            WHERE connection_id = $1
              AND date >= $2
              AND date <= $3
              AND customer_id = $4
            """,
            conn_id, from_date, to_date, selected_id,
        )
    else:
        rows = await conn.fetch(
            """
            SELECT date, spend
            FROM google_ads_daily_metrics
            WHERE connection_id = $1
              AND date >= $2
              AND date <= $3
            """,
            conn_id, from_date, to_date,
        )

    return [{"date": r["date"], "spend": float(r["spend"] or 0)} for r in rows]


async def _fetch_shiprocket_shipments(
    conn: asyncpg.Connection,
    shiprocket_conn: dict | None,
) -> list[dict]:
    """§4.8 All shiprocket_shipments (no date filter). Only when connection CONNECTED."""
    if not shiprocket_conn or shiprocket_conn.get("status") != "CONNECTED":
        return []

    rows = await conn.fetch(
        """
        SELECT shipped_at, shiprocket_created_at, raw_json
        FROM shiprocket_shipments
        WHERE connection_id = $1
        """,
        shiprocket_conn["id"],
    )
    result = []
    for r in rows:
        raw = r["raw_json"]
        # asyncpg may return raw_json as str or dict depending on column type
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                raw = None
        result.append({
            "shippedAt": r["shipped_at"],
            "shiprocketCreatedAt": r["shiprocket_created_at"],
            "rawJson": raw,
        })
    return result


async def _fetch_all_orders(
    conn: asyncpg.Connection,
    connection_id: str,
    from_date: datetime,
    to_date: datetime,
    order_inclusion_conditions: str,
    params_prefix: list,
) -> list[dict]:
    """§4.9 shopify_orders in range (with order filters applied).

    Selected fields: id, customer_shopify_id, processed_at, total_price,
    total_tax, total_discount, currency.
    """
    params = [connection_id, from_date, to_date] + params_prefix

    sql = f"""
        SELECT id, customer_shopify_id, processed_at,
               total_price, total_tax, total_discount, currency
        FROM shopify_orders so
        WHERE connection_id = $1
          AND processed_at >= $2
          AND processed_at <= $3
          {order_inclusion_conditions}
    """
    rows = await conn.fetch(sql, *params)
    return [
        {
            "id": str(r["id"]),
            "customerShopifyId": r["customer_shopify_id"],
            "processedAt": r["processed_at"],           # datetime
            "totalPrice": float(r["total_price"] or 0),
            "totalTax": float(r["total_tax"] or 0),
            "totalDiscount": float(r["total_discount"] or 0),
            "currency": r["currency"] or "USD",
        }
        for r in rows
    ]


async def _fetch_filtered_daily(
    conn: asyncpg.Connection,
    connection_id: str,
    from_date: datetime,
    to_date: datetime,
    order_inclusion_conditions: str,
    params_prefix: list,
) -> dict[str, dict]:
    """§4.10 Aggregate orders by day when order filters are active.

    Mirrors TS getFilteredDailyAggregates: GROUP BY date, sum totalPrice + count.
    Returns {} if no filters (caller should check has_no_order_filters first).
    """
    params = [connection_id, from_date, to_date] + params_prefix

    sql = f"""
        SELECT
            DATE(processed_at) AS day,
            SUM(total_price)::float AS gross_sales,
            COUNT(*)::int AS orders_count
        FROM shopify_orders so
        WHERE connection_id = $1
          AND processed_at >= $2
          AND processed_at <= $3
          {order_inclusion_conditions}
        GROUP BY DATE(processed_at)
    """
    rows = await conn.fetch(sql, *params)
    result: dict[str, dict] = {}
    for r in rows:
        day_str = r["day"].isoformat() if hasattr(r["day"], "isoformat") else str(r["day"])[:10]
        result[day_str] = {
            "grossSales": float(r["gross_sales"] or 0),
            "ordersCount": int(r["orders_count"] or 0),
        }
    return result


# ---------------------------------------------------------------------------
# Serial store-currency lookup (single-connection safe)
# ---------------------------------------------------------------------------

async def _get_store_currency_serial(
    conn: asyncpg.Connection,
    connection_id: str,
    from_date: date,
    to_date: date,
    fallback: str = "USD",
) -> str:
    """Serial version of get_shopify_store_currency for single-connection use.

    Mirrors the 4-priority chain in store_currency.py but sequentially (no
    asyncio.gather) so it works on a single asyncpg connection in pgbouncer
    transaction mode.

    Priority (same as TS):
        1. Most-recent order currency in range
        2. Most-recent analytics currency in range
        3. Most-recent order currency overall
        4. Most-recent analytics currency overall
        5. fallback
    """
    def _clean(val: str | None) -> str:
        return val.strip() if val and val.strip() else ""

    # 1. Order in range
    row = await conn.fetchrow(
        """
        SELECT currency FROM shopify_orders
        WHERE connection_id = $1
          AND processed_at >= $2
          AND processed_at <= $3
        ORDER BY processed_at DESC LIMIT 1
        """,
        connection_id,
        datetime(from_date.year, from_date.month, from_date.day, 0, 0, 0),
        datetime(to_date.year, to_date.month, to_date.day, 23, 59, 59),
    )
    if row and _clean(row["currency"]):
        return _clean(row["currency"])

    # 2. Daily analytics in range
    row = await conn.fetchrow(
        """
        SELECT currency FROM shopify_analytics_daily
        WHERE connection_id = $1
          AND date >= $2
          AND date <= $3
        ORDER BY date DESC LIMIT 1
        """,
        connection_id, from_date, to_date,
    )
    if row and _clean(row["currency"]):
        return _clean(row["currency"])

    # 3. Latest order overall
    row = await conn.fetchrow(
        """
        SELECT currency FROM shopify_orders
        WHERE connection_id = $1
        ORDER BY processed_at DESC LIMIT 1
        """,
        connection_id,
    )
    if row and _clean(row["currency"]):
        return _clean(row["currency"])

    # 4. Latest analytics overall
    row = await conn.fetchrow(
        """
        SELECT currency FROM shopify_analytics_daily
        WHERE connection_id = $1
        ORDER BY date DESC LIMIT 1
        """,
        connection_id,
    )
    if row and _clean(row["currency"]):
        return _clean(row["currency"])

    return fallback


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def compute_pnl(
    conn: asyncpg.Connection,
    request: metrics_pb2.GetPnLRequest,
) -> metrics_pb2.PnLResponse:
    """Compute P&L rows for a workspace and date range.

    Mirrors apps/frontend/app/api/workspaces/[slug]/pnl/route.ts GET handler,
    lines 81-834. Auth + featureGuard are handled by the proxy (Task 13).

    Args:
        conn:    asyncpg connection acquired from pool.
        request: GetPnLRequest proto with workspace_id, from_date, to_date,
                 granularity.

    Returns:
        PnLResponse with rows (newest-first) and currency string.
    """
    workspace_id = request.workspace_id
    from_str = request.from_date  # 'yyyy-MM-dd'
    to_str = request.to_date      # 'yyyy-MM-dd'
    proto_granularity = request.granularity

    # --- Granularity mapping ---
    granularity = _PROTO_TO_GRANULARITY.get(proto_granularity, Granularity.DAY)

    # --- Date parsing ---
    # TS: fromDate = new Date(`${fromStr}T00:00:00.000Z`)
    #     toDate   = new Date(`${toStr}T23:59:59.999Z`)
    try:
        from_date_d = date.fromisoformat(from_str)
        to_date_d = date.fromisoformat(to_str)
    except (ValueError, TypeError):
        return _EMPTY_RESPONSE

    if from_date_d > to_date_d:
        return _EMPTY_RESPONSE

    # UTC datetime boundaries for processedAt queries.
    # asyncpg requires naive datetimes (no tzinfo) for TIMESTAMP columns stored without tz.
    # The TS uses T00:00:00.000Z ... T23:59:59.999Z — we use the same UTC boundaries, naive.
    from_dt = datetime(from_date_d.year, from_date_d.month, from_date_d.day, 0, 0, 0)
    to_dt = datetime(to_date_d.year, to_date_d.month, to_date_d.day, 23, 59, 59, 999000)
    # Timezone-aware versions for allocate_monthly_to_bucket (expects aware datetimes).
    from_dt_aware = datetime(from_date_d.year, from_date_d.month, from_date_d.day, 0, 0, 0, tzinfo=timezone.utc)
    to_dt_aware = datetime(to_date_d.year, to_date_d.month, to_date_d.day, 23, 59, 59, 999000, tzinfo=timezone.utc)

    # --- Load workspace ---
    workspace = await _fetch_workspace(conn, workspace_id)
    if not workspace:
        return _EMPTY_RESPONSE

    # --- Platform check ---
    platform = workspace.get("platform", "SHOPIFY")
    is_woocommerce = platform == "WOOCOMMERCE"

    if is_woocommerce:
        # TODO: WooCommerce — deferred to later sub-project
        return _EMPTY_RESPONSE

    # --- Load shopify connection ---
    shopify_conn = await _fetch_shopify_connection(conn, workspace_id)
    if not shopify_conn:
        # TS: no CONNECTED shopify connection → return { rows: [], currency: 'USD' }
        return _EMPTY_RESPONSE

    connection_id = str(shopify_conn["id"])

    # --- Load all connection/settings rows (parallel would be ideal; sequential is safe for SP-1) ---
    cogs_raw = await _fetch_cogs_settings(conn, workspace_id)
    meta_conn = await _fetch_meta_ads_connection(conn, workspace_id)
    google_conn = await _fetch_google_ads_connection(conn, workspace_id)
    shiprocket_conn = await _fetch_shiprocket_connection(conn, workspace_id)

    # --- Order filter settings ---
    order_filter_settings = normalize_order_filter_settings(workspace)
    order_where_dict = {
        "skipped_tags": list(order_filter_settings.skipped_shopify_order_tags),
        "skip_zero_sales": order_filter_settings.skip_zero_sales_orders,
    }

    # Build SQL conditions + params for order-filtered queries.
    # Params for orders: base params are $1=connection_id, $2=from_dt, $3=to_dt → base=3
    # For line items:    $1=connection_id, $2=connection_id, $3=from_dt, $4=to_dt → base=4
    # For filteredDaily: $1=connection_id, $2=from_dt, $3=to_dt → base=3
    orders_extra_params: list = []
    orders_conditions = _build_order_inclusion_conditions(
        order_where_dict, "so", orders_extra_params, base_param_count=3
    )
    li_extra_params: list = []
    li_conditions = _build_order_inclusion_conditions(
        order_where_dict, "so", li_extra_params, base_param_count=4
    )

    # --- The 10 parallel data fetches (sequential for SP-1) ---
    daily_analytics = await _fetch_daily_analytics(conn, connection_id, from_date_d, to_date_d)

    workspace_costs = await _fetch_workspace_costs(conn, workspace_id, to_date_d)

    misc_expenses = await _fetch_misc_expenses(conn, workspace_id, to_date_d)

    coq_map = await _fetch_products(conn, connection_id)

    line_items_raw = await _fetch_line_items(
        conn, connection_id, from_dt, to_dt, li_conditions, li_extra_params
    )

    meta_ad_daily = await _fetch_meta_ad_daily(conn, meta_conn, from_date_d, to_date_d)

    google_ad_daily = await _fetch_google_ad_daily(conn, google_conn, from_date_d, to_date_d)

    shiprocket_shipments = await _fetch_shiprocket_shipments(conn, shiprocket_conn)

    all_orders = await _fetch_all_orders(
        conn, connection_id, from_dt, to_dt, orders_conditions, orders_extra_params
    )

    # §4.10 filteredDaily — only when order filters are active
    if has_no_order_filters(order_filter_settings):
        filtered_daily: dict[str, dict] = {}
    else:
        # TODO: WooCommerce path would skip this; Shopify path fetches it.
        # Re-build params for the filtered_daily query (same base as allOrders: base=3).
        fd_extra_params: list = []
        fd_conditions = _build_order_inclusion_conditions(
            order_where_dict, "so", fd_extra_params, base_param_count=3
        )
        filtered_daily = await _fetch_filtered_daily(
            conn, connection_id, from_dt, to_dt, fd_conditions, fd_extra_params
        )

    # --- Store currency ---
    # Note: get_shopify_store_currency uses asyncio.gather internally, which
    # parallelises queries on the same connection — that works fine when called
    # from a pool (each subtask gets its own connection), but breaks on a single
    # shared connection (pgbouncer transaction mode + asyncpg serial writes).
    # We call a serial inline version here to avoid the "another operation in
    # progress" error.
    store_currency = await _get_store_currency_serial(
        conn, connection_id, from_date_d, to_date_d
    )

    # --- Build order-derived daily rows (analytics fallback — §8) ---
    # TS lines 447-508: for dates with orders but no analytics row, synthesise
    # a pseudo-analytics row from aggregated orders.
    order_derived_by_date: dict[str, dict] = {}
    for o in all_orders:
        order_date = o["processedAt"]
        if not order_date:
            continue
        if hasattr(order_date, "strftime"):
            date_str = order_date.strftime("%Y-%m-%d")
        else:
            date_str = str(order_date)[:10]

        cur = order_derived_by_date.get(date_str)
        if cur is None:
            cur = {
                "grossSales": 0.0,
                "totalDiscount": 0.0,
                "totalTax": 0.0,
                "ordersCount": 0,
                "total_returns": 0.0,   # Shopify orders don't carry per-order refund → 0
                "returns": 0.0,
            }
            order_derived_by_date[date_str] = cur

        cur["grossSales"] += o["totalPrice"]
        cur["totalDiscount"] += o["totalDiscount"]
        cur["totalTax"] += o["totalTax"]
        cur["ordersCount"] += 1
        # For Shopify (not WooCommerce), total_returns and returns stay 0
        # (TS: getOrderTotalRefund(o) = isWoocommerce ? ... : 0)

    analytics_date_set = {
        (r["date"].isoformat() if hasattr(r["date"], "isoformat") else str(r["date"])[:10])
        for r in daily_analytics
    }
    order_only_dates = [d for d in order_derived_by_date if d not in analytics_date_set]

    order_derived_rows = []
    for date_str in order_only_dates:
        v = order_derived_by_date[date_str]
        order_derived_rows.append({
            "date": date.fromisoformat(date_str),
            "netSales": v["grossSales"] - abs(v["totalDiscount"]),
            "grossSales": v["grossSales"],
            "totalTax": v["totalTax"],
            "totalDiscount": v["totalDiscount"],
            "ordersCount": v["ordersCount"],
            "currency": store_currency,
            "total_returns": v["total_returns"],
            "returns": v["returns"],
        })

    # Merge: analytics rows + order-derived rows for missing dates, sorted ASC
    effective_daily = sorted(
        daily_analytics + order_derived_rows,
        key=lambda r: r["date"],
    )

    # --- COGS computation ---
    # Build LineItemWithDate list from fetched line items
    line_items_with_date: list[LineItemWithDate] = []
    for li in line_items_raw:
        processed_at = li["order_processed_at"]
        if not processed_at:
            continue
        # Convert datetime → date for LineItemWithDate
        if hasattr(processed_at, "date"):
            li_date = processed_at.date()
        else:
            li_date = date.fromisoformat(str(processed_at)[:10])

        line_items_with_date.append(
            LineItemWithDate(
                price=li["price"],
                quantity=li["quantity"],
                product_shopify_id=li["product_shopify_id"],
                order_processed_at=li_date,
            )
        )

    cogs_settings = normalize_cogs_settings(cogs_raw)
    _total_cogs, daily_cogs = compute_line_items_cogs(line_items_with_date, coq_map, cogs_settings)

    # --- Daily return maps ---
    daily_total_returns: dict[str, float] = {}
    daily_returns: dict[str, float] = {}
    for d in effective_daily:
        d_date = d["date"]
        date_str = d_date.isoformat() if hasattr(d_date, "isoformat") else str(d_date)[:10]
        daily_total_returns[date_str] = float(d.get("total_returns") or 0)
        daily_returns[date_str] = float(d.get("returns") or 0)

    # --- Daily ad spend maps ---
    daily_ad_spend: dict[str, float] = {}
    daily_meta_ad_spend: dict[str, float] = {}
    daily_google_ad_spend: dict[str, float] = {}

    for r in meta_ad_daily:
        d_val = r["date"]
        d_str = d_val.isoformat() if hasattr(d_val, "isoformat") else str(d_val)[:10]
        spend = r["spend"]
        daily_meta_ad_spend[d_str] = daily_meta_ad_spend.get(d_str, 0.0) + spend
        daily_ad_spend[d_str] = daily_ad_spend.get(d_str, 0.0) + spend

    for r in google_ad_daily:
        d_val = r["date"]
        d_str = d_val.isoformat() if hasattr(d_val, "isoformat") else str(d_val)[:10]
        spend = r["spend"]
        daily_google_ad_spend[d_str] = daily_google_ad_spend.get(d_str, 0.0) + spend
        daily_ad_spend[d_str] = daily_ad_spend.get(d_str, 0.0) + spend

    # --- NC/EC revenue computation (TS lines 575-619) ---
    # For each customer, find their first order date within the range.
    # asyncpg returns naive datetime for processed_at — compare directly.
    first_at_map: dict[str, Any] = {}  # cid → naive datetime
    for order in all_orders:
        cid = order.get("customerShopifyId")
        if not cid:
            continue
        order_date = order["processedAt"]
        if not order_date:
            continue
        existing = first_at_map.get(cid)
        if existing is None or order_date < existing:
            first_at_map[cid] = order_date

    buckets = get_buckets(from_date_d, to_date_d, granularity)

    bucket_nc_revenue: dict[str, float] = {}
    bucket_ec_revenue: dict[str, float] = {}

    for order in all_orders:
        order_date = order["processedAt"]
        if not order_date:
            continue
        rev = order["totalPrice"] - order["totalTax"]
        cid = order.get("customerShopifyId")
        first_at = first_at_map.get(cid) if cid else None
        # TS: isFirst = firstAt != null && orderDate.getTime() === firstAt.getTime()
        # Both are naive UTC datetimes from asyncpg → compare directly.
        is_first = (
            first_at is not None and order_date == first_at
        )

        # Find which bucket this order belongs to by comparing date portion.
        order_date_str = order_date.strftime("%Y-%m-%d") if hasattr(order_date, "strftime") else str(order_date)[:10]
        bucket_key: str | None = None
        for b in buckets:
            if b.start_date.isoformat() <= order_date_str <= b.end_date.isoformat():
                bucket_key = b.key
                break

        if not bucket_key:
            continue

        if is_first:
            bucket_nc_revenue[bucket_key] = bucket_nc_revenue.get(bucket_key, 0.0) + rev
        else:
            bucket_ec_revenue[bucket_key] = bucket_ec_revenue.get(bucket_key, 0.0) + rev

    # --- Shiprocket shipping costs: monthPrevAvg (TS lines 622-655) ---
    # monthPrevAvg[yyyy-mm] = prev full month's avg charge per order
    month_prev_avg: dict[str, float] = {}
    if shiprocket_shipments:
        # Build order count by month from effective_daily
        order_count_by_month: dict[str, int] = {}
        for d in effective_daily:
            d_date = d["date"]
            ym = (d_date.isoformat() if hasattr(d_date, "isoformat") else str(d_date)[:10])[:7]
            order_count_by_month[ym] = order_count_by_month.get(ym, 0) + int(d.get("ordersCount") or 0)

        shipments_by_month: dict[str, dict] = {}
        for s in shiprocket_shipments:
            at = s["shippedAt"] or s["shiprocketCreatedAt"]
            if not at:
                continue
            ym = (at.isoformat() if hasattr(at, "isoformat") else str(at))[:7]
            total_charge = total_charges_from_raw(s["rawJson"]).total
            cur = shipments_by_month.get(ym)
            if cur is None:
                cur = {"totalCharges": 0.0, "orderCount": 0}
                shipments_by_month[ym] = cur
            cur["totalCharges"] += total_charge
            cur["orderCount"] += 1

        sorted_months = sorted(shipments_by_month.keys())
        for i in range(1, len(sorted_months)):
            prev_month = sorted_months[i - 1]
            curr_month = sorted_months[i]
            prev = shipments_by_month[prev_month]
            prev_orders = order_count_by_month.get(prev_month, 1) or 1
            if prev and prev_orders > 0:
                avg = prev["totalCharges"] / prev_orders
                month_prev_avg[curr_month] = avg

    # --- Founder salary ---
    founder_monthly_raw = workspace.get("founder_salary_monthly")
    founder_monthly = float(founder_monthly_raw) if founder_monthly_raw is not None else 0.0
    founder_currency = workspace.get("founder_salary_currency") or "INR"

    # --- Per-bucket computation (TS lines 657-820) ---
    rows: list[metrics_pb2.PnLRow] = []

    for bucket in buckets:
        date_strings = get_bucket_utc_date_strings(bucket)

        gross_sales = 0.0
        total_discount = 0.0
        total_tax_bucket = 0.0
        orders_count = 0
        cogs = 0.0
        ad_spend = 0.0
        meta_ad_spend = 0.0
        google_ad_spend = 0.0
        variable_costs = 0.0
        fixed_costs = 0.0

        for date_str in date_strings:
            # Source priority: filteredDaily > effectiveDaily (§5)
            filtered = filtered_daily.get(date_str)
            daily = next(
                (d for d in effective_daily
                 if (d["date"].isoformat() if hasattr(d["date"], "isoformat") else str(d["date"])[:10]) == date_str),
                None,
            )

            # ordersCount and grossSales
            if filtered:
                day_orders = filtered["ordersCount"]
                day_gross = filtered["grossSales"]
                gross_sales += filtered["grossSales"]
                orders_count += filtered["ordersCount"]
            elif daily:
                day_orders = int(daily.get("ordersCount") or 0)
                day_gross = float(daily.get("grossSales") or 0)
                gross_sales += day_gross
                orders_count += day_orders
            else:
                day_orders = 0
                day_gross = 0.0

            # totalDiscount and totalTax always from effectiveDaily (not filteredDaily)
            if daily:
                total_discount += float(daily.get("totalDiscount") or 0)
                total_tax_bucket += float(daily.get("totalTax") or 0)

            # COGS
            cogs += daily_cogs.get(date_str, 0.0)

            # Ad spend
            ad_spend += daily_ad_spend.get(date_str, 0.0)
            meta_ad_spend += daily_meta_ad_spend.get(date_str, 0.0)
            google_ad_spend += daily_google_ad_spend.get(date_str, 0.0)

            # Variable costs — iterate active workspace costs for this day
            for cost in workspace_costs:
                cost_from_str = _date_to_str(cost["effectiveFrom"])
                cost_to_str = _date_to_str(cost["effectiveTo"]) if cost["effectiveTo"] else "9999-12-31"
                if cost_from_str <= date_str <= cost_to_str:
                    variable_costs += get_daily_variable_contribution_from_dict(
                        cost, date_str, day_orders, day_gross, store_currency
                    )

            # Fixed costs: misc expenses prorated by daysInMonth
            day_date = date.fromisoformat(date_str)
            days_in_month = calendar.monthrange(day_date.year, day_date.month)[1]
            for e in misc_expenses:
                e_start = _date_to_str(e["effectiveStartDate"])
                if date_str >= e_start:
                    fixed_costs += (
                        convert_currency(e["amount"], e["currency"] or "INR", store_currency)
                        / days_in_month
                    )

        # Refunds from effectiveDaily
        total_returns_bucket = sum(daily_total_returns.get(ds, 0.0) for ds in date_strings)
        returns_bucket = sum(daily_returns.get(ds, 0.0) for ds in date_strings)
        refunds = total_returns_bucket
        product_refunds = returns_bucket
        shipping_refunds = total_returns_bucket - returns_bucket

        # Derived metrics (TS lines 738-766)
        sales = gross_sales
        discounts = total_discount
        discounts_amount = abs(discounts)
        net_sales = sales - discounts_amount

        refunds_amount = abs(refunds)
        revenue = sales - refunds_amount

        taxes_amount = abs(total_tax_bucket)
        net_revenue = revenue - taxes_amount

        nc_net_revenue = bucket_nc_revenue.get(bucket.key, 0.0)
        ec_net_revenue = bucket_ec_revenue.get(bucket.key, 0.0)

        # Shipping costs: prev month avg × ordersCount
        bucket_month_key = bucket.start_date.isoformat()[:7]
        prev_month_avg = month_prev_avg.get(bucket_month_key, 0.0)
        shipping_costs = prev_month_avg * orders_count

        # Founder salary allocation (needs aware datetimes for boundary comparison)
        founder_allocated = allocate_monthly_to_bucket(
            convert_currency(founder_monthly, founder_currency, store_currency),
            bucket,
            from_dt_aware,
            to_dt_aware,
        )

        # Contribution margins
        cm1 = net_sales - cogs - variable_costs
        cm2 = cm1 - ad_spend
        cm3 = cm2 - fixed_costs
        net_profit = cm3 - founder_allocated

        rows.append(
            metrics_pb2.PnLRow(
                bucket_key=bucket.key,
                label=bucket.label,
                gross_sales=gross_sales,
                discounts=discounts,
                sales=gross_sales,
                net_sales=net_sales,
                product_gross=gross_sales,
                shipping_gross=0.0,
                product_discount=discounts,
                shipping_discount=0.0,
                product_net=net_sales,
                shipping_net=0.0,
                refunds=refunds,
                product_refunds=product_refunds,
                shipping_refunds=shipping_refunds,
                return_fees=0.0,
                revenue=revenue,
                nc_net_revenue=nc_net_revenue,
                ec_net_revenue=ec_net_revenue,
                net_revenue=net_revenue,
                cogs=cogs,
                variable_costs=variable_costs,
                shipping_costs=shipping_costs,
                returns_costs=0.0,
                payment_costs=0.0,
                customs_costs=0.0,
                other_variable=0.0,
                ad_spend=ad_spend,
                meta_ad_spend=meta_ad_spend,
                google_ad_spend=google_ad_spend,
                contribution_margin1=cm1,
                contribution_margin2=cm2,
                contribution_margin3=cm3,
                fixed_costs=fixed_costs,
                founder_salary_allocated=founder_allocated,
                net_profit=net_profit,
                orders_count=orders_count,
            )
        )

    return metrics_pb2.PnLResponse(rows=rows, currency=store_currency)


# ---------------------------------------------------------------------------
# Internal utility helpers
# ---------------------------------------------------------------------------

def _datetime_as_ms(dt: datetime | None) -> int:
    """Convert a datetime to milliseconds since epoch (for TS getTime() parity).

    TS: orderDate.getTime() === firstAt.getTime()
    Handles both naive (assumed UTC) and aware datetimes.
    """
    if dt is None:
        return -1
    if dt.tzinfo is None:
        # asyncpg returns naive datetimes for timestamps stored without tz
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _date_to_str(d: Any) -> str:
    """Convert a date/datetime object or string to 'yyyy-MM-dd' string."""
    if d is None:
        return ""
    if hasattr(d, "isoformat"):
        return d.isoformat()[:10]
    return str(d)[:10]


