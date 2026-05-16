"""Shiprocket charge breakdown — port of apps/frontend/lib/shiprocket-charges.ts.

--- Deviations from TS ---

1. ChargeBreakdown dataclass (plan-sketch addition):
   The TS totalChargesFromRaw returns a plain float (forward + rto + cod).
   The Python port wraps the three components in a ChargeBreakdown dataclass
   so callers (and tests) can inspect each component. The .total property
   reproduces the TS scalar return value exactly.  queries/pnl.py (Task 11)
   should call total_charges_from_raw(raw).total to match TS behaviour.

2. get_number (internal helper):
   Directly ported from the TS getNumber — nested key traversal via dot-path
   string. Handles None, non-object nodes, numeric strings, and NaN exactly
   as the TS does.

3. forward_charges_from_raw / rto_charges_from_raw / cod_charges_from_raw:
   All three TS helpers are exported from shiprocket-charges.ts but the task
   spec only requires total_charges_from_raw. The individual helpers are
   ported and exposed anyway so tests can verify each component.

   Forward charge path priority (mirrors TS line-for-line):
     charges.applied_weight_amount
     charges.charge_weight_amount      ← NOTE: NOT "charged_weight_amount"
     charges.freight_charges
     freight_charges                   ← top-level fallback

   RTO charge path priority:
     charges.applied_weight_amount_rto
     charges.charged_weight_amount_rto ← NOTE: "charged" (different from fwd)

   COD charge:
     charges.cod_charges
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any


# ---------------------------------------------------------------------------
# Internal helper — port of TS getNumber
# ---------------------------------------------------------------------------

def _get_number(raw: Any, path: str) -> float | None:
    """Traverse a nested dict by dot-separated path and return the value as float.

    Mirrors TS getNumber exactly:
    - Returns None if any node along the path is None or not a dict.
    - Returns None if the leaf is NaN.
    - Coerces numeric strings via float(); returns None if not parseable.
    - Returns None for any other type.
    """
    if raw is None:
        return None
    parts = path.split(".")
    current: Any = raw
    for p in parts:
        if current is None or not isinstance(current, dict):
            return None
        current = current.get(p)
    if isinstance(current, (int, float)) and not (
        isinstance(current, float) and math.isnan(current)
    ):
        return float(current)
    if isinstance(current, str):
        try:
            n = float(current)
        except (ValueError, TypeError):
            return None
        return None if math.isnan(n) else n
    return None


# ---------------------------------------------------------------------------
# Component helpers (exported; mirror TS named exports)
# ---------------------------------------------------------------------------

def forward_charges_from_raw(raw_json: Any) -> float:
    """Forward (outbound) shipping charge from a shipment's raw_json.

    Mirrors lib/shiprocket-charges.ts::forwardChargesFromRaw.
    Path priority:
      charges.applied_weight_amount
      charges.charge_weight_amount
      charges.freight_charges
      freight_charges
    """
    if raw_json is None:
        return 0.0
    return (
        _get_number(raw_json, "charges.applied_weight_amount")
        or _get_number(raw_json, "charges.charge_weight_amount")
        or _get_number(raw_json, "charges.freight_charges")
        or _get_number(raw_json, "freight_charges")
        or 0.0
    )


def rto_charges_from_raw(raw_json: Any) -> float:
    """RTO (return) shipping charge from a shipment's raw_json.

    Mirrors lib/shiprocket-charges.ts::rtoChargesFromRaw.
    Path priority:
      charges.applied_weight_amount_rto
      charges.charged_weight_amount_rto
    """
    if raw_json is None:
        return 0.0
    return (
        _get_number(raw_json, "charges.applied_weight_amount_rto")
        or _get_number(raw_json, "charges.charged_weight_amount_rto")
        or 0.0
    )


def cod_charges_from_raw(raw_json: Any) -> float:
    """COD handling charge from a shipment's raw_json.

    Mirrors lib/shiprocket-charges.ts::codChargesFromRaw.
    Path: charges.cod_charges
    """
    if raw_json is None:
        return 0.0
    return _get_number(raw_json, "charges.cod_charges") or 0.0


# ---------------------------------------------------------------------------
# ChargeBreakdown dataclass
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ChargeBreakdown:
    """Structured breakdown of Shiprocket shipment charges.

    Fields mirror the three components that TS totalChargesFromRaw sums:
      forward: outbound freight charge
      rto:     return freight charge
      cod:     cash-on-delivery handling charge
    """
    forward: float
    rto: float
    cod: float

    @property
    def total(self) -> float:
        """Sum of all components — matches TS totalChargesFromRaw scalar return."""
        return self.forward + self.rto + self.cod


# ---------------------------------------------------------------------------
# total_charges_from_raw
# ---------------------------------------------------------------------------

def total_charges_from_raw(raw_json: Any) -> ChargeBreakdown:
    """Sum the raw shipment charges JSON into a typed breakdown.

    Port of lib/shiprocket-charges.ts::totalChargesFromRaw. Handles None /
    empty / partial dicts; missing keys treated as 0. Behaviour mirrors TS
    line-for-line.

    Args:
      raw_json: the parsed JSON from ShiprocketShipment.rawJson, or None.

    Returns:
      ChargeBreakdown with .forward, .rto, .cod components and .total sum.
      .total exactly equals what the TS function returns.
    """
    if raw_json is None:
        return ChargeBreakdown(forward=0.0, rto=0.0, cod=0.0)
    return ChargeBreakdown(
        forward=forward_charges_from_raw(raw_json),
        rto=rto_charges_from_raw(raw_json),
        cod=cod_charges_from_raw(raw_json),
    )
