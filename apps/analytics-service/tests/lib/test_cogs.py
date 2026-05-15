"""Unit tests for src/lib/cogs.py — settings normalisation + line-item resolution.

Note on the actual TS API vs. the task spec sketch:
    The task spec assumed CogsSettings held `overrides: dict[str, float]` (SKU-level map).
    The ACTUAL TS (lib/cogs/resolve.ts) uses THREE percentage fields:
        overrideAllCogsPercent, fallbackCogsPercent, cogsMarkupPercent
    and takes a separate `coqMap: Map<productShopifyId, coq>` argument (product-level
    unit cost, not a per-SKU override dict).

    Tests below match the real TS API. The three spec-sketch tests are re-implemented
    using the real semantics — the spirit (override beats coq, 0-override is honored,
    empty settings → 0) is preserved, just expressed via percentages + coq_map.
"""
from __future__ import annotations

from datetime import date

import pytest

from src.lib.cogs import (
    CogsSettings,
    LineItemForCogs,
    LineItemWithDate,
    compute_line_items_cogs,
    normalize_cogs_settings,
    resolve_line_item_cogs,
)


# ---------------------------------------------------------------------------
# normalize_cogs_settings
# ---------------------------------------------------------------------------

class TestNormalizeCogsSettings:
    def test_none_returns_zeros(self):
        """TS: if (!raw) return {0,0,0}"""
        s = normalize_cogs_settings(None)
        assert s.override_all_cogs_percent == 0.0
        assert s.fallback_cogs_percent == 0.0
        assert s.cogs_markup_percent == 0.0

    def test_empty_dict_returns_zeros(self):
        s = normalize_cogs_settings({})
        assert s == CogsSettings(0.0, 0.0, 0.0)

    def test_camel_case_dict(self):
        raw = {
            "overrideAllCogsPercent": 30,
            "fallbackCogsPercent": 20,
            "cogsMarkupPercent": 10,
        }
        s = normalize_cogs_settings(raw)
        assert s.override_all_cogs_percent == 30.0
        assert s.fallback_cogs_percent == 20.0
        assert s.cogs_markup_percent == 10.0

    def test_snake_case_dict(self):
        raw = {
            "override_all_cogs_percent": "25",
            "fallback_cogs_percent": "15",
            "cogs_markup_percent": "5",
        }
        s = normalize_cogs_settings(raw)
        assert s.override_all_cogs_percent == 25.0
        assert s.fallback_cogs_percent == 15.0
        assert s.cogs_markup_percent == 5.0

    def test_string_numbers_coerced(self):
        """TS: Number(raw.overrideAllCogsPercent) || 0 — strings become floats."""
        s = normalize_cogs_settings({"overrideAllCogsPercent": "40.5"})
        assert s.override_all_cogs_percent == 40.5

    def test_invalid_string_becomes_zero(self):
        """TS: Number("abc") → NaN → || 0. Python: float("abc") raises → 0.0."""
        s = normalize_cogs_settings({"overrideAllCogsPercent": "abc"})
        assert s.override_all_cogs_percent == 0.0

    def test_decimal_object_coerced(self):
        """Prisma Decimal objects coerce via float()."""
        from decimal import Decimal
        s = normalize_cogs_settings({"overrideAllCogsPercent": Decimal("35.00")})
        assert s.override_all_cogs_percent == 35.0


# ---------------------------------------------------------------------------
# resolve_line_item_cogs — the resolution chain
# ---------------------------------------------------------------------------

class TestResolveLineItemCogs:
    """Tests mirror the TS resolution chain:
        1. overridePct > 0 → baseCogs = revenue × (overridePct/100)
        2. else coq > 0   → baseCogs = coq × qty
        3. else fallbackPct > 0 → baseCogs = revenue × (fallbackPct/100)
        4. else → 0
        After: markupPct > 0 → baseCogs × (1 + markupPct/100)
    """

    # --- Branch 1: override percent ---

    def test_override_beats_coq(self):
        """The spec sketch 'override beats product cost' — expressed via overridePercent."""
        # override 50% means COGS = revenue × 0.50 regardless of coq_map
        settings = CogsSettings(override_all_cogs_percent=50.0)
        item = LineItemForCogs(price=100.0, quantity=2, product_shopify_id="P1")
        coq_map = {"P1": 999.0}  # high coq; override should win
        # revenue = 100 × 2 = 200; COGS = 200 × 0.50 = 100
        assert resolve_line_item_cogs(item, coq_map, settings) == 100.0

    def test_override_with_no_coq_map_entry(self):
        settings = CogsSettings(override_all_cogs_percent=30.0)
        item = LineItemForCogs(price=200.0, quantity=1, product_shopify_id="P2")
        coq_map: dict[str, float] = {}
        # revenue = 200; COGS = 200 × 0.30 = 60
        assert resolve_line_item_cogs(item, coq_map, settings) == 60.0

    # --- Branch 2: coq map ---

    def test_coq_map_used_when_no_override(self):
        settings = CogsSettings(override_all_cogs_percent=0.0, fallback_cogs_percent=20.0)
        item = LineItemForCogs(price=500.0, quantity=3, product_shopify_id="P3")
        coq_map = {"P3": 80.0}  # coq 80 per unit
        # coq > 0 → baseCogs = 80 × 3 = 240 (fallback ignored)
        assert resolve_line_item_cogs(item, coq_map, settings) == 240.0

    def test_coq_zero_falls_through_to_fallback(self):
        """coq stored as 0.0 → coq > 0 is False → fallback branch activates."""
        settings = CogsSettings(fallback_cogs_percent=25.0)
        item = LineItemForCogs(price=100.0, quantity=4, product_shopify_id="P4")
        coq_map = {"P4": 0.0}  # zero coq — treated as "no cost set"
        # revenue = 400; COGS = 400 × 0.25 = 100
        assert resolve_line_item_cogs(item, coq_map, settings) == 100.0

    def test_none_product_id_skips_coq_lookup(self):
        """productShopifyId=None → coq lookup skipped; falls to fallback."""
        settings = CogsSettings(fallback_cogs_percent=10.0)
        item = LineItemForCogs(price=100.0, quantity=2, product_shopify_id=None)
        coq_map = {"P5": 50.0}
        # revenue = 200; COGS = 200 × 0.10 = 20
        assert resolve_line_item_cogs(item, coq_map, settings) == 20.0

    # --- Branch 3: fallback percent ---

    def test_fallback_when_no_coq(self):
        settings = CogsSettings(fallback_cogs_percent=15.0)
        item = LineItemForCogs(price=200.0, quantity=2, product_shopify_id="P6")
        coq_map: dict[str, float] = {}  # no entry → coq = 0 → fallback
        # revenue = 400; COGS = 400 × 0.15 = 60
        assert resolve_line_item_cogs(item, coq_map, settings) == 60.0

    # --- Branch 4: all zeros ---

    def test_empty_settings_no_coq_returns_zero(self):
        """Spec sketch: 'empty settings, no costs → 0'."""
        settings = CogsSettings()  # all zeros
        item = LineItemForCogs(price=100.0, quantity=5, product_shopify_id="P7")
        coq_map: dict[str, float] = {}
        assert resolve_line_item_cogs(item, coq_map, settings) == 0.0

    # --- Markup ---

    def test_markup_applied_on_top_of_override(self):
        """TS: return markupPct > 0 ? baseCogs × (1 + markupPct/100) : baseCogs"""
        settings = CogsSettings(override_all_cogs_percent=50.0, cogs_markup_percent=10.0)
        item = LineItemForCogs(price=100.0, quantity=2, product_shopify_id=None)
        coq_map: dict[str, float] = {}
        # baseCogs = 200 × 0.50 = 100; with 10% markup = 100 × 1.10 = 110
        assert resolve_line_item_cogs(item, coq_map, settings) == pytest.approx(110.0)

    def test_markup_applied_on_top_of_coq(self):
        settings = CogsSettings(cogs_markup_percent=20.0)
        item = LineItemForCogs(price=100.0, quantity=2, product_shopify_id="P8")
        coq_map = {"P8": 50.0}
        # baseCogs = 50 × 2 = 100; markup = 100 × 1.20 = 120
        assert resolve_line_item_cogs(item, coq_map, settings) == 120.0

    def test_zero_markup_not_applied(self):
        """markupPct = 0 → no multiplication (branch: markupPct > 0)."""
        settings = CogsSettings(override_all_cogs_percent=50.0, cogs_markup_percent=0.0)
        item = LineItemForCogs(price=100.0, quantity=1, product_shopify_id=None)
        coq_map: dict[str, float] = {}
        # baseCogs = 100 × 0.50 = 50; no markup
        assert resolve_line_item_cogs(item, coq_map, settings) == 50.0

    # --- Spec-sketch scenario: zero override is honored ---

    def test_zero_override_not_honored_as_override(self):
        """The spec sketch expected 0.0 override to mean 'COGS = 0'.
        ACTUAL TS: overridePct > 0 check — 0.0 is NOT > 0, so override branch
        is NOT taken. Falls through to coq/fallback. This is the correct TS behavior.
        """
        settings = CogsSettings(override_all_cogs_percent=0.0)
        item = LineItemForCogs(price=100.0, quantity=5, product_shopify_id=None)
        coq_map: dict[str, float] = {}
        # override NOT active (0.0 is not > 0), no coq, no fallback → 0
        # Note: the spec sketch expected this to be 0 but for the wrong reason.
        # It's 0 because all branches produce 0, NOT because 0.0 override is honored.
        assert resolve_line_item_cogs(item, coq_map, settings) == 0.0


# ---------------------------------------------------------------------------
# compute_line_items_cogs
# ---------------------------------------------------------------------------

class TestComputeLineItemsCogs:
    def test_empty_list_returns_zeros(self):
        settings = CogsSettings(override_all_cogs_percent=30.0)
        total, daily = compute_line_items_cogs([], {}, settings)
        assert total == 0.0
        assert daily == {}

    def test_sums_across_items(self):
        settings = CogsSettings(override_all_cogs_percent=50.0)
        items = [
            LineItemWithDate(price=100.0, quantity=2),  # COGS = 200×0.5 = 100
            LineItemWithDate(price=50.0, quantity=4),   # COGS = 200×0.5 = 100
        ]
        total, daily = compute_line_items_cogs(items, {}, settings)
        assert total == 200.0
        assert daily == {}  # no order_processed_at set

    def test_daily_breakdown(self):
        settings = CogsSettings(override_all_cogs_percent=100.0)  # COGS = revenue
        d1 = date(2024, 1, 1)
        d2 = date(2024, 1, 2)
        items = [
            LineItemWithDate(price=100.0, quantity=1, order_processed_at=d1),  # COGS = 100
            LineItemWithDate(price=200.0, quantity=1, order_processed_at=d1),  # COGS = 200
            LineItemWithDate(price=150.0, quantity=1, order_processed_at=d2),  # COGS = 150
        ]
        total, daily = compute_line_items_cogs(items, {}, settings)
        assert total == 450.0
        assert daily == {"2024-01-01": 300.0, "2024-01-02": 150.0}

    def test_items_without_date_excluded_from_daily(self):
        settings = CogsSettings(override_all_cogs_percent=100.0)
        items = [
            LineItemWithDate(price=100.0, quantity=1, order_processed_at=date(2024, 1, 1)),
            LineItemWithDate(price=200.0, quantity=1, order_processed_at=None),  # no date
        ]
        total, daily = compute_line_items_cogs(items, {}, settings)
        assert total == 300.0
        assert daily == {"2024-01-01": 100.0}  # only the dated item

    def test_coq_map_used_in_batch(self):
        """compute_line_items_cogs passes coq_map through to resolve_line_item_cogs."""
        settings = CogsSettings()  # no override, no fallback
        items = [
            LineItemWithDate(price=100.0, quantity=2, product_shopify_id="PA",
                             order_processed_at=date(2024, 6, 1)),
            LineItemWithDate(price=100.0, quantity=3, product_shopify_id="PB",
                             order_processed_at=date(2024, 6, 1)),
        ]
        coq_map = {"PA": 10.0, "PB": 20.0}
        total, daily = compute_line_items_cogs(items, coq_map, settings)
        # PA: 10×2=20, PB: 20×3=60 → total=80
        assert total == 80.0
        assert daily == {"2024-06-01": 80.0}

    def test_spec_sketch_override_beats_product_cost(self):
        """Spirit of spec sketch test 1: 'override beats product cost'.
        Expressed via overridePercent (not SKU dict).
        """
        settings = CogsSettings(override_all_cogs_percent=50.0)
        items = [LineItemWithDate(price=20.0, quantity=2, product_shopify_id="SKU-A")]
        coq_map = {"SKU-A": 999.0}  # high coq — override wins
        total, _ = compute_line_items_cogs(items, coq_map, settings)
        # revenue = 40; COGS = 40 × 0.50 = 20
        assert total == 20.0

    def test_spec_sketch_empty_settings_returns_zero(self):
        """Spirit of spec sketch test 3: 'no overrides, no costs → 0'."""
        settings = CogsSettings()  # all zeros
        items = [LineItemWithDate(price=100.0, quantity=1, product_shopify_id="SKU-A")]
        coq_map: dict[str, float] = {}
        total, _ = compute_line_items_cogs(items, coq_map, settings)
        assert total == 0.0
