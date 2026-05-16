"""Order-filter helpers — port of apps/frontend/lib/order-filters.ts.

Shopify-side helpers are fully ported:
  - normalize_order_filter_settings
  - has_no_order_filters
  - get_order_inclusion_where          (renamed from getOrderInclusionWhereFromWorkspace;
                                        see deviation note below)
  - get_order_inclusion_where_from_workspace (alias kept for pnl.py import compat)
  - get_filtered_daily_aggregates

WooCommerce helpers raise NotImplementedError — WooCommerce filtering is
deferred to a follow-on sub-project. The parity-test fixture for SP-1 is
Shopify-only, so this is safe; an accidental call must fail loudly.

--- Deviations from plan sketch ---

1. get_order_inclusion_where_from_workspace (TS name) is kept as the primary
   exported name (matches the TS export and the pnl-port-notes helper map,
   Section 6). get_order_inclusion_where is a thin internal helper — same as
   TS getOrderInclusionWhere, which is not exported from order-filters.ts.

2. get_filtered_daily_aggregates in TS is async and takes a PrismaClient — it
   performs a live DB query. Per pnl-port-notes.md §4.10, the Python port
   inlines that DB query inside queries/pnl.py (Task 11). The Python version
   here takes pre-fetched order rows (list[dict]) and aggregates them in
   memory, mirroring the TS grouping logic without the DB call.

3. get_order_inclusion_where_from_workspace returns a *dict* describing a SQL
   WHERE fragment, NOT a Prisma object. queries/pnl.py (Task 11) translates
   this dict into asyncpg-parameterised SQL.

   Dict shape:
     {
       "skipped_tags":   list[str],   # tags to exclude; empty = no tag filter
       "skip_zero_sales": bool,        # if True, exclude totalPrice <= 0
     }

   When both lists are empty/false the dict still has both keys — callers
   should check has_no_order_filters() first and skip the WHERE entirely.

4. extractWoocommerceOrderType is intentionally NOT exported. It is an internal
   TS helper used only by resolveWoocommerceOrderType and
   isWoocommerceOrderIncluded, both of which raise NotImplementedError here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Settings type
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class OrderFilterSettings:
    """Mirrors TS OrderFilterSettings.

    Fields:
      skipped_shopify_order_tags: list of Shopify order tag strings to exclude.
      skip_zero_sales_orders:     if True, exclude orders with totalPrice <= 0.
    """
    skipped_shopify_order_tags: tuple[str, ...] = field(default_factory=tuple)
    skip_zero_sales_orders: bool = False

    # Convenience: allow construction from list (tuples are hashable / frozen-safe)
    def __init__(
        self,
        skipped_shopify_order_tags: list[str] | tuple[str, ...] = (),
        skip_zero_sales_orders: bool = False,
    ) -> None:
        object.__setattr__(
            self,
            "skipped_shopify_order_tags",
            tuple(skipped_shopify_order_tags),
        )
        object.__setattr__(self, "skip_zero_sales_orders", skip_zero_sales_orders)


_DEFAULT_SETTINGS = OrderFilterSettings(
    skipped_shopify_order_tags=(),
    skip_zero_sales_orders=False,
)


# ---------------------------------------------------------------------------
# normalize_order_filter_settings
# ---------------------------------------------------------------------------

def normalize_order_filter_settings(
    raw: dict | Any | None,
) -> OrderFilterSettings:
    """Mirrors lib/order-filters.ts::normalizeOrderFilterSettings.

    Accepts camelCase (skippedShopifyOrderTags, skipZeroSalesOrders) or
    snake_case (skipped_shopify_order_tags, skip_zero_sales_orders) input —
    both as dict keys and as object attributes. camelCase takes priority
    (mirrors TS: fromCamel checked first, then fromSnake).

    Non-string elements in the tag list are silently dropped (TS:
    ``filter((t): t is string => typeof t === 'string')``).
    """
    if raw is None:
        return _DEFAULT_SETTINGS

    # Resolve as dict or attribute access.
    def _get(key_camel: str, key_snake: str) -> Any:
        if isinstance(raw, dict):
            if key_camel in raw:
                return raw[key_camel]
            if key_snake in raw:
                return raw[key_snake]
            return None
        # object attribute access
        camel_val = getattr(raw, key_camel, None)
        if camel_val is not None:
            return camel_val
        return getattr(raw, key_snake, None)

    # Tags: camelCase first, then snake_case (mirrors TS fromCamel / fromSnake).
    from_camel = _get("skippedShopifyOrderTags", "__UNUSED__")
    if isinstance(raw, dict):
        from_snake = raw.get("skipped_shopify_order_tags")
    else:
        from_snake = getattr(raw, "skipped_shopify_order_tags", None)

    tag_source: list | None = None
    if isinstance(from_camel, (list, tuple)):
        tag_source = list(from_camel)
    elif isinstance(from_snake, (list, tuple)):
        tag_source = list(from_snake)
    else:
        tag_source = []

    tags = [t for t in tag_source if isinstance(t, str)]

    # skipZero: camelCase first, then snake_case; coerce to bool.
    skip_camel = _get("skipZeroSalesOrders", "__UNUSED__")
    if isinstance(raw, dict):
        skip_snake = raw.get("skip_zero_sales_orders")
    else:
        skip_snake = getattr(raw, "skip_zero_sales_orders", None)

    skip_zero_val = skip_camel if skip_camel is not None else skip_snake
    skip_zero = bool(skip_zero_val)

    return OrderFilterSettings(
        skipped_shopify_order_tags=tags,
        skip_zero_sales_orders=skip_zero,
    )


# ---------------------------------------------------------------------------
# has_no_order_filters
# ---------------------------------------------------------------------------

def has_no_order_filters(settings: OrderFilterSettings) -> bool:
    """Mirrors lib/order-filters.ts::hasNoOrderFilters.

    Returns True when the workspace has no order-inclusion/exclusion rules,
    meaning the fast daily-aggregate path is safe to use without further
    filtering.
    """
    return (
        len(settings.skipped_shopify_order_tags) == 0
        and not settings.skip_zero_sales_orders
    )


# ---------------------------------------------------------------------------
# get_order_inclusion_where  (internal, mirrors TS getOrderInclusionWhere)
# get_order_inclusion_where_from_workspace  (exported, mirrors TS export)
# ---------------------------------------------------------------------------

def _get_order_inclusion_where(settings: OrderFilterSettings) -> dict:
    """Internal — mirrors TS getOrderInclusionWhere (not exported in TS).

    Returns a dict that queries/pnl.py (Task 11) translates into asyncpg SQL:
      {
        "skipped_tags":    list[str],
        "skip_zero_sales": bool,
      }
    """
    return {
        "skipped_tags": list(settings.skipped_shopify_order_tags),
        "skip_zero_sales": settings.skip_zero_sales_orders,
    }


def get_order_inclusion_where_from_workspace(
    workspace: dict | Any,
) -> dict:
    """Mirrors lib/order-filters.ts::getOrderInclusionWhereFromWorkspace.

    Normalises workspace order-filter settings and returns a WHERE-fragment
    dict for use in asyncpg SQL (see _get_order_inclusion_where for shape).

    Dict shape:
      {
        "skipped_tags":    list[str],   # Shopify order tags to EXCLUDE
        "skip_zero_sales": bool,         # True → exclude orders where totalPrice <= 0
      }

    Callers should call has_no_order_filters(settings) first; if it returns
    True the WHERE fragment is a no-op and can be omitted entirely.
    """
    settings = normalize_order_filter_settings(workspace)
    return _get_order_inclusion_where(settings)


# ---------------------------------------------------------------------------
# get_filtered_daily_aggregates
# ---------------------------------------------------------------------------

def get_filtered_daily_aggregates(
    order_rows: list[dict],
    settings: OrderFilterSettings,
) -> dict[str, dict]:
    """Mirrors the aggregation logic of lib/order-filters.ts::getFilteredDailyAggregates.

    TS version is async and queries the DB directly; Python version accepts
    pre-fetched order rows (list of dicts with at least 'processedAt' and
    'totalPrice' keys) and aggregates in memory.  The DB query itself lives
    in queries/pnl.py (Task 11) — this function only does the grouping.

    Args:
      order_rows: list of dicts, each with:
        - 'processedAt': datetime (UTC) or ISO-8601 string
        - 'totalPrice':  float | Decimal | str
      settings: OrderFilterSettings

    Returns:
      dict mapping date string 'yyyy-MM-dd' → {'grossSales': float, 'ordersCount': int}
      Empty dict when has_no_order_filters(settings) is True (mirrors TS ``return new Map()``).
    """
    if has_no_order_filters(settings):
        return {}

    by_date: dict[str, dict] = {}
    for o in order_rows:
        processed_at = o["processedAt"]
        # Support datetime objects or ISO strings.
        if hasattr(processed_at, "strftime"):
            date_str = processed_at.strftime("%Y-%m-%d")
        else:
            date_str = str(processed_at)[:10]

        cur = by_date.get(date_str)
        if cur is None:
            cur = {"grossSales": 0.0, "ordersCount": 0}
            by_date[date_str] = cur
        cur["grossSales"] += float(o["totalPrice"])
        cur["ordersCount"] += 1

    return by_date


# ---------------------------------------------------------------------------
# WooCommerce helpers — OUT OF SCOPE for Phase 5 SP-1.
# Raise NotImplementedError loudly so an accidental call during /pnl assembly
# fails visibly instead of causing a silent parity diff downstream.
# ---------------------------------------------------------------------------

def is_woocommerce_order_included(*args: Any, **kwargs: Any) -> bool:
    raise NotImplementedError(
        "WooCommerce order filtering is deferred to a later sub-project. "
        "Phase 5 SP-1 fixture workspaces must be Shopify-only."
    )


def resolve_woocommerce_order_type(*args: Any, **kwargs: Any) -> Any:
    raise NotImplementedError(
        "WooCommerce order-type resolution is deferred to a later sub-project. "
        "Phase 5 SP-1 fixture workspaces must be Shopify-only."
    )
