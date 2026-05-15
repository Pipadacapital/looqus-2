"""Unit tests for src/lib/currency.py — verbatim port of EXCHANGE_RATES +
convertCurrency from the /pnl route.

TS source: apps/frontend/app/api/workspaces/[slug]/pnl/route.ts lines 25-41.

EXCHANGE_RATES = { USD:1, INR:83.5, EUR:0.92, GBP:0.79, AUD:1.53, CAD:1.35 }

convertCurrency(amount, from, to):
    if (!from || !to || from === to) return amount
    fromRate = EXCHANGE_RATES[from] || 1
    toRate   = EXCHANGE_RATES[to]   || 1
    return (amount / fromRate) * toRate

If a test fails, the Python port deviates from TS — DO NOT change the test;
fix the port.
"""
from __future__ import annotations

from src.lib.currency import EXCHANGE_RATES, convert_currency


def test_same_currency_no_op():
    assert convert_currency(100.0, "USD", "USD") == 100.0
    assert convert_currency(100.0, "INR", "INR") == 100.0


def test_inr_to_usd_uses_table():
    # EXCHANGE_RATES: USD=1, INR=83.5
    # convert(8350, INR, USD) = 8350 / 83.5 * 1 = 100
    assert abs(convert_currency(8350.0, "INR", "USD") - 100.0) < 0.0001


def test_usd_to_inr():
    # convert(100, USD, INR) = 100 / 1 * 83.5 = 8350
    assert abs(convert_currency(100.0, "USD", "INR") - 8350.0) < 0.0001


def test_eur_to_gbp():
    # convert(0.92, EUR, GBP) = 0.92 / 0.92 * 0.79 = 0.79
    assert abs(convert_currency(0.92, "EUR", "GBP") - 0.79) < 0.0001


def test_unknown_currency_treated_as_one():
    # TS: const fromRate = EXCHANGE_RATES[from] || 1
    # Missing currency uses rate 1.
    # convert(100, "ZZZ", "USD") = 100 / 1 * 1 = 100
    assert convert_currency(100.0, "ZZZ", "USD") == 100.0


def test_unknown_to_currency_treated_as_one():
    # convert(100, "USD", "ZZZ") = 100 / 1 * 1 = 100
    assert convert_currency(100.0, "USD", "ZZZ") == 100.0


def test_empty_from_is_no_op():
    # TS: if (!from || ...) return amount
    assert convert_currency(100.0, "", "USD") == 100.0


def test_empty_to_is_no_op():
    # TS: if (... || !to || ...) return amount
    assert convert_currency(100.0, "USD", "") == 100.0


def test_table_contains_required_currencies():
    for c in ("USD", "INR", "EUR", "GBP", "AUD", "CAD"):
        assert c in EXCHANGE_RATES


def test_table_values_exact():
    """Exact rate values from the TS route — must not drift."""
    assert EXCHANGE_RATES["USD"] == 1.0
    assert EXCHANGE_RATES["INR"] == 83.5
    assert EXCHANGE_RATES["EUR"] == 0.92
    assert EXCHANGE_RATES["GBP"] == 0.79
    assert EXCHANGE_RATES["AUD"] == 1.53
    assert EXCHANGE_RATES["CAD"] == 1.35


def test_zero_amount():
    assert convert_currency(0.0, "INR", "USD") == 0.0
