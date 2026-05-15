"""Workspace cost contribution resolution.

Port of apps/frontend/lib/workspace-costs.ts::getDailyVariableContribution.

The TS file defines its own EXCHANGE_RATES + convertCurrency inline. Per the
port notes (Section 8, "Currency conversion"): Python should have one shared
src/lib/currency.py — we import convert_currency from there instead of
duplicating the table.

TS exported surface (lines 46-77):
    getDailyVariableContribution(cost, dateStr, ordersCount, grossSales, storeCurrency) → number

For each costType:
    SHIPPING / PACKAGING:
        billingMode == 'per_order' (or legacy null → TS defaults to 'monthly'):
            amount × ordersCount
        billingMode == 'monthly' (or default):
            amount / daysInMonth(dateStr)
    WEBSITE:
        isPercent → (amount / 100) × grossSales   [uses raw cost.amount, not converted]
        else      → amount × ordersCount           [uses converted amount]
    CUSTOM:
        amount × ordersCount                       [uses converted amount]
    anything else → 0

Important TS quirk preserved:
    WEBSITE isPercent branch uses `cost.amount` (raw, unconverted) not `amount` —
    this matches the TS source exactly (line 68: `(cost.amount / 100) * grossSales`).
    This is intentional: isPercent costs are dimensionless ratios, not currency amounts,
    so currency conversion would be meaningless. Replicate verbatim.

The billingMode default in TS is 'monthly' (line 55: `cost.billingMode ?? 'monthly'`),
NOT 'per_order'. A null/undefined billingMode means monthly spread, not per-order.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date

from src.lib.currency import convert_currency


# ---------------------------------------------------------------------------
# Types (mirroring TS exported types)
# ---------------------------------------------------------------------------

# TS: WorkspaceCostBillingMode = 'monthly' | 'per_order'
BILLING_MODE_MONTHLY = "monthly"
BILLING_MODE_PER_ORDER = "per_order"


@dataclass
class WorkspaceCostForContribution:
    """Port of TS type WorkspaceCostForContribution (workspace-costs.ts lines 27-33).

    Matches the WorkspaceCost DB row fields consumed by getDailyVariableContribution.
    """
    cost_type: str          # costType: 'SHIPPING' | 'PACKAGING' | 'WEBSITE' | 'CUSTOM'
    amount: float           # amount (monetary or %)
    currency: str | None    # ISO code; None → treated as 'USD' (TS: cost.currency ?? 'USD')
    is_percent: bool        # isPercent
    billing_mode: str | None = None  # billingMode: 'monthly' | 'per_order' | None


def _days_in_month_for_date_str(date_str: str) -> int:
    """Return the number of days in the month of the given YYYY-MM-DD string.

    TS: getDaysInMonth(new Date(dateStr + 'T12:00:00.000Z'))
    date-fns getDaysInMonth uses the calendar month of the date. Using T12:00:00Z
    ensures the UTC date isn't shifted by timezone. Python calendar.monthrange
    gives the same answer without a datetime object.
    """
    d = date.fromisoformat(date_str)
    return calendar.monthrange(d.year, d.month)[1]


def get_daily_variable_contribution(
    cost: WorkspaceCostForContribution,
    date_str: str,
    orders_count: int,
    gross_sales: float,
    store_currency: str,
) -> float:
    """Port of lib/workspace-costs.ts::getDailyVariableContribution (lines 46-77).

    Args:
        cost:           A single WorkspaceCost row (normalised into dataclass).
        date_str:       UTC calendar day string 'YYYY-MM-DD'.
        orders_count:   Number of relevant orders on this day.
        gross_sales:    Gross sales revenue on this day (in store_currency).
        store_currency: ISO currency code of the workspace's store.

    Returns:
        The cost contribution (in store_currency) for this single cost row on
        this single day. Caller sums across all active cost rows.
    """
    cost_from = cost.currency or "USD"
    # Convert the monetary amount to store currency.
    amount = convert_currency(cost.amount, cost_from, store_currency)

    # TS: const mode = cost.billingMode ?? 'monthly'
    # Default is 'monthly', NOT 'per_order'.
    mode = cost.billing_mode if cost.billing_mode is not None else BILLING_MODE_MONTHLY

    if cost.cost_type in ("SHIPPING", "PACKAGING"):
        if mode == BILLING_MODE_PER_ORDER:
            return amount * orders_count
        # monthly: spread the monthly fixed amount evenly across the month
        days = _days_in_month_for_date_str(date_str)
        return amount / days

    if cost.cost_type == "WEBSITE":
        if cost.is_percent:
            # TS line 68: (cost.amount / 100) * grossSales  ← raw cost.amount, NOT converted
            # isPercent costs are dimensionless ratios — currency conversion is irrelevant.
            return (cost.amount / 100) * gross_sales
        return amount * orders_count

    if cost.cost_type == "CUSTOM":
        return amount * orders_count

    return 0.0


def get_daily_variable_contribution_from_dict(
    cost_row: dict,
    date_str: str,
    orders_count: int,
    gross_sales: float,
    store_currency: str,
) -> float:
    """Convenience wrapper accepting a raw dict (e.g. asyncpg row mapped to dict).

    Maps snake_case DB column names to WorkspaceCostForContribution fields.
    Handles both camelCase (TS shape) and snake_case (DB column name) keys.
    """
    def _get(camel: str, snake: str, default: object = None) -> object:
        return cost_row.get(camel, cost_row.get(snake, default))

    cost = WorkspaceCostForContribution(
        cost_type=str(_get("costType", "cost_type", "")),
        amount=float(_get("amount", "amount", 0) or 0),
        currency=_get("currency", "currency", None),  # type: ignore[arg-type]
        is_percent=bool(_get("isPercent", "is_percent", False)),
        billing_mode=_get("billingMode", "billing_mode", None),  # type: ignore[arg-type]
    )
    return get_daily_variable_contribution(cost, date_str, orders_count, gross_sales, store_currency)
