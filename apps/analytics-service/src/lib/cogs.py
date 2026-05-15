"""COGS resolution. Port of apps/frontend/lib/cogs/resolve.ts.

Ported symbols:
    CogsSettings          — normalize_cogs_settings() output (3 float fields)
    LineItemForCogs       — input shape for resolve_line_item_cogs()
    LineItemWithDate      — LineItemForCogs + optional order_processed_at
    normalize_cogs_settings()  — coerce DB row to CogsSettings
    resolve_line_item_cogs()   — override → coq → fallback → markup chain
    compute_line_items_cogs()  — aggregate over a list; returns (total, daily dict)

Resolution chain (mirrors TS exactly):
    1. overrideAllCogsPercent > 0 → COGS = revenue × (override/100)
    2. else: look up coq via coq_map[productShopifyId]; if coq > 0 → coq × qty
    3. else: fallbackCogsPercent > 0 → revenue × (fallback/100)
    4. else: 0
    After base COGS: if cogsMarkupPercent > 0 → baseCogs × (1 + markup/100)

The coq_map is a separate dict (product shopify ID → unit cost) built by the
caller from ShopifyProduct rows — it is NOT part of CogsSettings. This matches
the TS function signatures exactly.

Note: the task spec sketch assumed CogsSettings held an overrides dict keyed by
SKU. The actual TS source uses three percentage fields with a separate coq_map
argument. Python mirrors the TS, not the sketch.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CogsSettings:
    """Port of TS type CogsSettings (lib/cogs/resolve.ts lines 15-19).

    Fields are floats because normalizeCogsSettings coerces with Number(),
    which converts Prisma Decimal → JS number. We coerce at construction time.
    """
    override_all_cogs_percent: float = 0.0  # overrideAllCogsPercent
    fallback_cogs_percent: float = 0.0       # fallbackCogsPercent
    cogs_markup_percent: float = 0.0         # cogsMarkupPercent


@dataclass
class LineItemForCogs:
    """Port of TS type LineItemForCogs (lib/cogs/resolve.ts lines 21-25).

    Fields:
        price             — unit selling price at time of order (Shopify ShopifyLineItem.price)
        quantity          — units sold
        product_shopify_id — nullable; used as key into coq_map
    """
    price: float
    quantity: int
    product_shopify_id: str | None = None


@dataclass
class LineItemWithDate(LineItemForCogs):
    """Port of TS type LineItemWithDate (lib/cogs/resolve.ts lines 75-78).

    Extends LineItemForCogs with an optional order date for daily breakdown.
    """
    order_processed_at: date | None = None


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

def normalize_cogs_settings(raw: Any) -> CogsSettings:
    """Port of lib/cogs/resolve.ts::normalizeCogsSettings (lines 28-39).

    Accepts a dict-like object with camelCase or snake_case keys (DB row or
    Prisma-shaped dict). Returns a CogsSettings with all fields as floats.

    If raw is None/falsy → all zeros (TS: if (!raw) return {0,0,0}).

    TS coercion: Number(x) || 0 — converts Decimal/string to number; NaN → 0.
    Python equivalent: float(x) if parseable, else 0.0.
    """
    if not raw:
        return CogsSettings()

    def _to_float(val: Any) -> float:
        try:
            result = float(val)
            # mirror JS: NaN → 0 (float('nan') is truthy but Number() coerces NaN → 0)
            return result if result == result else 0.0  # NaN check
        except (TypeError, ValueError):
            return 0.0

    # Accept both dict and object with attributes; try dict access first.
    def _get(key_camel: str, key_snake: str) -> Any:
        if isinstance(raw, dict):
            return raw.get(key_camel, raw.get(key_snake, 0))
        return getattr(raw, key_camel, getattr(raw, key_snake, 0))

    return CogsSettings(
        override_all_cogs_percent=_to_float(_get("overrideAllCogsPercent", "override_all_cogs_percent")),
        fallback_cogs_percent=_to_float(_get("fallbackCogsPercent", "fallback_cogs_percent")),
        cogs_markup_percent=_to_float(_get("cogsMarkupPercent", "cogs_markup_percent")),
    )


def resolve_line_item_cogs(
    line_item: LineItemForCogs,
    coq_map: dict[str, float],
    settings: CogsSettings,
) -> float:
    """Port of lib/cogs/resolve.ts::resolveLineItemCogs (lines 51-73).

    Resolution chain (mirrors TS exactly):
        if overridePct > 0:
            baseCogs = revenue × (overridePct / 100)
        else:
            coq = coq_map.get(productShopifyId) or 0
            if coq > 0:
                baseCogs = coq × quantity
            elif fallbackPct > 0:
                baseCogs = revenue × (fallbackPct / 100)
            else:
                baseCogs = 0
        return markupPct > 0 ? baseCogs × (1 + markupPct/100) : baseCogs

    Note: TS uses ?? 0 for coq_map lookup (nullish coalescing), which treats
    undefined as 0 but lets 0.0 itself through — matching Python dict.get default.
    The coq > 0 check then gates on strictly positive coq, so a stored coq of 0
    falls through to the fallback branch.
    """
    revenue = float(line_item.price) * line_item.quantity

    override_pct = settings.override_all_cogs_percent
    fallback_pct = settings.fallback_cogs_percent
    markup_pct = settings.cogs_markup_percent

    if override_pct > 0:
        base_cogs = revenue * (override_pct / 100)
    else:
        # TS: coq_map.get(productShopifyId) ?? 0
        coq = coq_map.get(line_item.product_shopify_id or "", 0.0) if line_item.product_shopify_id else 0.0
        if coq > 0:
            base_cogs = coq * line_item.quantity
        elif fallback_pct > 0:
            base_cogs = revenue * (fallback_pct / 100)
        else:
            base_cogs = 0.0

    return base_cogs * (1 + markup_pct / 100) if markup_pct > 0 else base_cogs


def compute_line_items_cogs(
    line_items: list[LineItemWithDate],
    coq_map: dict[str, float],
    settings: CogsSettings,
) -> tuple[float, dict[str, float]]:
    """Port of lib/cogs/resolve.ts::computeLineItemsCogs (lines 89-128).

    Aggregates COGS across all line items and optionally breaks down by day.

    Returns:
        (total_cogs, daily_cogs)
        total_cogs  — sum of resolve_line_item_cogs() across all items
        daily_cogs  — dict mapping YYYY-MM-DD → accumulated COGS for that day
                      (only items with order_processed_at contribute)

    TS return shape: { totalCogs: number; dailyCogs: Map<string, number> }
    Python: tuple of (float, dict[str, float]) — equivalent semantics.

    The TS dev-mode console.log sample is omitted — no console.log in Python.
    """
    daily_cogs: dict[str, float] = {}
    total_cogs = 0.0

    for item in line_items:
        cogs = resolve_line_item_cogs(item, coq_map, settings)
        total_cogs += cogs
        if item.order_processed_at is not None:
            # TS: item.orderProcessedAt.toISOString().slice(0, 10)
            date_str = item.order_processed_at.isoformat()[:10]
            daily_cogs[date_str] = daily_cogs.get(date_str, 0.0) + cogs

    return total_cogs, daily_cogs
