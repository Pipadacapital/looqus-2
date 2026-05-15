"""Unit tests for src/lib/workspace_costs.py.

Tests exercise get_daily_variable_contribution() with hand-built WorkspaceCostForContribution
inputs, covering all costType branches and billingMode variants.

TS field names used in WorkspaceCost DB rows:
    costType    : str   ('SHIPPING' | 'PACKAGING' | 'WEBSITE' | 'CUSTOM')
    amount      : float
    currency    : str | None
    isPercent   : bool
    billingMode : 'monthly' | 'per_order' | None  (None → defaults to 'monthly')

Key TS quirk exercised here:
    WEBSITE isPercent uses raw cost.amount (not converted) — see workspace_costs.py docstring.
    billingMode default is 'monthly', NOT 'per_order'.
"""
from __future__ import annotations

import calendar
from datetime import date

import pytest

from src.lib.workspace_costs import (
    WorkspaceCostForContribution,
    get_daily_variable_contribution,
    get_daily_variable_contribution_from_dict,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DATE_JAN_15 = "2024-01-15"   # 31 days in January
DATE_FEB_15 = "2024-02-15"   # 29 days in February 2024 (leap year)
DATE_APR_1  = "2024-04-01"   # 30 days in April


def _days(date_str: str) -> int:
    d = date.fromisoformat(date_str)
    return calendar.monthrange(d.year, d.month)[1]


# ---------------------------------------------------------------------------
# SHIPPING — monthly (default)
# ---------------------------------------------------------------------------

class TestShippingMonthly:
    """billingMode='monthly' (or None → defaults to monthly): amount / daysInMonth."""

    def test_monthly_explicit(self):
        cost = WorkspaceCostForContribution(
            cost_type="SHIPPING",
            amount=3100.0,
            currency="INR",
            is_percent=False,
            billing_mode="monthly",
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=10, gross_sales=0.0, store_currency="INR")
        # 3100 / 31 = 100.0
        assert result == pytest.approx(100.0)

    def test_monthly_none_defaults_to_monthly(self):
        """TS: billingMode ?? 'monthly' — None → 'monthly'."""
        cost = WorkspaceCostForContribution(
            cost_type="SHIPPING",
            amount=2900.0,
            currency="INR",
            is_percent=False,
            billing_mode=None,
        )
        result = get_daily_variable_contribution(cost, DATE_FEB_15, orders_count=5, gross_sales=0.0, store_currency="INR")
        # 2900 / 29 = 100.0
        assert result == pytest.approx(100.0)

    def test_monthly_currency_conversion(self):
        """Monthly amount converted from USD to INR before dividing by days."""
        cost = WorkspaceCostForContribution(
            cost_type="SHIPPING",
            amount=31.0,  # USD
            currency="USD",
            is_percent=False,
            billing_mode="monthly",
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=0, gross_sales=0.0, store_currency="INR")
        # convert 31 USD → INR: 31 / 1.0 × 83.5 = 2588.5
        # 2588.5 / 31 days = 83.5 INR/day
        assert result == pytest.approx(83.5)


# ---------------------------------------------------------------------------
# SHIPPING — per_order
# ---------------------------------------------------------------------------

class TestShippingPerOrder:
    """billingMode='per_order': amount × ordersCount (spec-sketch scenario)."""

    def test_per_order_flat_shipping(self):
        """Spec sketch: 50 per order × 10 orders = 500."""
        cost = WorkspaceCostForContribution(
            cost_type="SHIPPING",
            amount=50.0,
            currency="INR",
            is_percent=False,
            billing_mode="per_order",
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=10, gross_sales=0.0, store_currency="INR")
        assert result == pytest.approx(500.0)

    def test_per_order_zero_orders(self):
        cost = WorkspaceCostForContribution(
            cost_type="SHIPPING",
            amount=50.0,
            currency="INR",
            is_percent=False,
            billing_mode="per_order",
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=0, gross_sales=0.0, store_currency="INR")
        assert result == pytest.approx(0.0)

    def test_per_order_currency_converted(self):
        """Per-order amount converted to store currency before multiplying."""
        cost = WorkspaceCostForContribution(
            cost_type="SHIPPING",
            amount=1.0,  # 1 USD
            currency="USD",
            is_percent=False,
            billing_mode="per_order",
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=5, gross_sales=0.0, store_currency="INR")
        # 1 USD → 83.5 INR; 83.5 × 5 = 417.5
        assert result == pytest.approx(417.5)


# ---------------------------------------------------------------------------
# PACKAGING
# ---------------------------------------------------------------------------

class TestPackaging:
    """PACKAGING follows same logic as SHIPPING (monthly vs per_order)."""

    def test_packaging_monthly(self):
        cost = WorkspaceCostForContribution(
            cost_type="PACKAGING",
            amount=300.0,
            currency="INR",
            is_percent=False,
            billing_mode="monthly",
        )
        result = get_daily_variable_contribution(cost, DATE_APR_1, orders_count=5, gross_sales=1000.0, store_currency="INR")
        # 300 / 30 = 10.0
        assert result == pytest.approx(10.0)

    def test_packaging_per_order(self):
        cost = WorkspaceCostForContribution(
            cost_type="PACKAGING",
            amount=20.0,
            currency="INR",
            is_percent=False,
            billing_mode="per_order",
        )
        result = get_daily_variable_contribution(cost, DATE_APR_1, orders_count=7, gross_sales=1000.0, store_currency="INR")
        assert result == pytest.approx(140.0)


# ---------------------------------------------------------------------------
# WEBSITE
# ---------------------------------------------------------------------------

class TestWebsite:
    def test_website_percent_uses_raw_amount(self):
        """TS quirk: isPercent branch uses cost.amount (not converted), × grossSales.
        Even if currency differs from store_currency, raw amount is used as a %.
        """
        cost = WorkspaceCostForContribution(
            cost_type="WEBSITE",
            amount=2.0,      # 2% (raw, not currency-converted)
            currency="USD",  # irrelevant when isPercent
            is_percent=True,
            billing_mode=None,
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=10, gross_sales=50000.0, store_currency="INR")
        # (2 / 100) × 50000 = 1000.0 (uses raw cost.amount=2, not converted)
        assert result == pytest.approx(1000.0)

    def test_website_flat_per_order(self):
        """isPercent=False: amount × ordersCount (with currency conversion)."""
        cost = WorkspaceCostForContribution(
            cost_type="WEBSITE",
            amount=100.0,
            currency="INR",
            is_percent=False,
            billing_mode=None,
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=5, gross_sales=10000.0, store_currency="INR")
        assert result == pytest.approx(500.0)

    def test_website_percent_zero_gross_sales(self):
        """0 gross_sales → 0 contribution even with isPercent."""
        cost = WorkspaceCostForContribution(
            cost_type="WEBSITE",
            amount=5.0,
            currency="INR",
            is_percent=True,
            billing_mode=None,
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=0, gross_sales=0.0, store_currency="INR")
        assert result == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# CUSTOM
# ---------------------------------------------------------------------------

class TestCustom:
    def test_custom_per_order(self):
        cost = WorkspaceCostForContribution(
            cost_type="CUSTOM",
            amount=15.0,
            currency="INR",
            is_percent=False,
            billing_mode=None,
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=8, gross_sales=5000.0, store_currency="INR")
        assert result == pytest.approx(120.0)

    def test_custom_currency_converted(self):
        """CUSTOM: amount converted to store currency, then × ordersCount."""
        cost = WorkspaceCostForContribution(
            cost_type="CUSTOM",
            amount=1.0,  # 1 USD
            currency="USD",
            is_percent=False,
            billing_mode=None,
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=2, gross_sales=0.0, store_currency="INR")
        # 1 USD → 83.5 INR; 83.5 × 2 = 167.0
        assert result == pytest.approx(167.0)


# ---------------------------------------------------------------------------
# Unknown costType
# ---------------------------------------------------------------------------

class TestUnknownCostType:
    def test_unknown_returns_zero(self):
        """TS: final return 0 for unrecognized costType."""
        cost = WorkspaceCostForContribution(
            cost_type="UNKNOWN_TYPE",
            amount=999.0,
            currency="INR",
            is_percent=False,
            billing_mode=None,
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=10, gross_sales=10000.0, store_currency="INR")
        assert result == 0.0


# ---------------------------------------------------------------------------
# Null currency defaults to USD
# ---------------------------------------------------------------------------

class TestNullCurrency:
    def test_none_currency_treated_as_usd(self):
        """TS: cost.currency ?? 'USD' — None currency → treated as USD."""
        cost = WorkspaceCostForContribution(
            cost_type="SHIPPING",
            amount=1.0,   # 1 USD (implicit)
            currency=None,
            is_percent=False,
            billing_mode="per_order",
        )
        result = get_daily_variable_contribution(cost, DATE_JAN_15, orders_count=1, gross_sales=0.0, store_currency="INR")
        # 1 USD → 83.5 INR; × 1 order = 83.5
        assert result == pytest.approx(83.5)


# ---------------------------------------------------------------------------
# Dict input wrapper
# ---------------------------------------------------------------------------

class TestFromDict:
    def test_from_dict_camel_case(self):
        """get_daily_variable_contribution_from_dict maps camelCase keys."""
        row = {
            "costType": "SHIPPING",
            "amount": 310.0,
            "currency": "INR",
            "isPercent": False,
            "billingMode": "monthly",
        }
        result = get_daily_variable_contribution_from_dict(row, DATE_JAN_15, 5, 0.0, "INR")
        assert result == pytest.approx(10.0)  # 310 / 31

    def test_from_dict_snake_case(self):
        """get_daily_variable_contribution_from_dict maps snake_case DB column names."""
        row = {
            "cost_type": "PACKAGING",
            "amount": 50.0,
            "currency": "INR",
            "is_percent": False,
            "billing_mode": "per_order",
        }
        result = get_daily_variable_contribution_from_dict(row, DATE_JAN_15, 3, 0.0, "INR")
        assert result == pytest.approx(150.0)
