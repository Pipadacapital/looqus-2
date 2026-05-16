"""Unit tests for src/lib/shiprocket_charges.py.

Field names and path priorities are taken directly from
apps/frontend/lib/shiprocket-charges.ts (read during porting):

  forward: charges.applied_weight_amount  (highest priority)
           charges.charge_weight_amount   (NOT "charged_weight_amount")
           charges.freight_charges
           freight_charges                (top-level fallback)

  rto:     charges.applied_weight_amount_rto
           charges.charged_weight_amount_rto  (note "charged" here, not "charge")

  cod:     charges.cod_charges
"""
from __future__ import annotations

import pytest

from src.lib.shiprocket_charges import (
    ChargeBreakdown,
    cod_charges_from_raw,
    forward_charges_from_raw,
    rto_charges_from_raw,
    total_charges_from_raw,
)


# ---------------------------------------------------------------------------
# None / empty / trivial inputs
# ---------------------------------------------------------------------------

def test_none_returns_zero_breakdown():
    b = total_charges_from_raw(None)
    assert b.forward == 0.0
    assert b.rto == 0.0
    assert b.cod == 0.0
    assert b.total == 0.0


def test_empty_dict_returns_zero():
    b = total_charges_from_raw({})
    assert b.total == 0.0


def test_charges_key_present_but_empty():
    b = total_charges_from_raw({"charges": {}})
    assert b.total == 0.0


# ---------------------------------------------------------------------------
# Forward charge — path priority
# ---------------------------------------------------------------------------

def test_forward_applied_weight_amount_is_highest_priority():
    raw = {
        "charges": {
            "applied_weight_amount": 120.0,
            "charge_weight_amount": 90.0,
            "freight_charges": 60.0,
        },
        "freight_charges": 30.0,
    }
    assert forward_charges_from_raw(raw) == 120.0


def test_forward_falls_back_to_charge_weight_amount():
    raw = {
        "charges": {
            "charge_weight_amount": 90.0,
            "freight_charges": 60.0,
        },
        "freight_charges": 30.0,
    }
    assert forward_charges_from_raw(raw) == 90.0


def test_forward_falls_back_to_charges_freight_charges():
    raw = {
        "charges": {
            "freight_charges": 60.0,
        },
        "freight_charges": 30.0,
    }
    assert forward_charges_from_raw(raw) == 60.0


def test_forward_falls_back_to_toplevel_freight_charges():
    raw = {"freight_charges": 30.0}
    assert forward_charges_from_raw(raw) == 30.0


def test_forward_none_input_returns_zero():
    assert forward_charges_from_raw(None) == 0.0


# ---------------------------------------------------------------------------
# RTO charge — path priority
# ---------------------------------------------------------------------------

def test_rto_applied_weight_amount_rto_is_highest_priority():
    raw = {
        "charges": {
            "applied_weight_amount_rto": 55.0,
            "charged_weight_amount_rto": 40.0,
        }
    }
    assert rto_charges_from_raw(raw) == 55.0


def test_rto_falls_back_to_charged_weight_amount_rto():
    raw = {"charges": {"charged_weight_amount_rto": 40.0}}
    assert rto_charges_from_raw(raw) == 40.0


def test_rto_none_input_returns_zero():
    assert rto_charges_from_raw(None) == 0.0


def test_rto_missing_key_returns_zero():
    assert rto_charges_from_raw({"charges": {}}) == 0.0


# ---------------------------------------------------------------------------
# COD charge
# ---------------------------------------------------------------------------

def test_cod_charges_from_raw():
    raw = {"charges": {"cod_charges": 25.0}}
    assert cod_charges_from_raw(raw) == 25.0


def test_cod_missing_returns_zero():
    assert cod_charges_from_raw({"charges": {}}) == 0.0


def test_cod_none_input_returns_zero():
    assert cod_charges_from_raw(None) == 0.0


# ---------------------------------------------------------------------------
# total_charges_from_raw — partial inputs (one component set)
# ---------------------------------------------------------------------------

def test_partial_only_forward_set():
    raw = {"charges": {"applied_weight_amount": 100.0}}
    b = total_charges_from_raw(raw)
    assert b.forward == 100.0
    assert b.rto == 0.0
    assert b.cod == 0.0
    assert b.total == 100.0


def test_partial_only_rto_set():
    raw = {"charges": {"applied_weight_amount_rto": 50.0}}
    b = total_charges_from_raw(raw)
    assert b.forward == 0.0
    assert b.rto == 50.0
    assert b.cod == 0.0
    assert b.total == 50.0


def test_partial_only_cod_set():
    raw = {"charges": {"cod_charges": 30.0}}
    b = total_charges_from_raw(raw)
    assert b.forward == 0.0
    assert b.rto == 0.0
    assert b.cod == 30.0
    assert b.total == 30.0


# ---------------------------------------------------------------------------
# total_charges_from_raw — full input sums correctly
# ---------------------------------------------------------------------------

def test_full_dict_sums():
    raw = {
        "charges": {
            "applied_weight_amount": 120.0,
            "applied_weight_amount_rto": 55.0,
            "cod_charges": 25.0,
        }
    }
    b = total_charges_from_raw(raw)
    assert b.forward == 120.0
    assert b.rto == 55.0
    assert b.cod == 25.0
    assert abs(b.total - 200.0) < 0.0001


def test_full_dict_with_all_fallback_paths():
    """Uses lower-priority paths to verify the full cascade is reachable."""
    raw = {
        "charges": {
            "charge_weight_amount": 80.0,
            "charged_weight_amount_rto": 40.0,
            "cod_charges": 15.0,
        }
    }
    b = total_charges_from_raw(raw)
    assert b.forward == 80.0
    assert b.rto == 40.0
    assert b.cod == 15.0
    assert abs(b.total - 135.0) < 0.0001


# ---------------------------------------------------------------------------
# Numeric string coercion (mirrors TS parseFloat behaviour)
# ---------------------------------------------------------------------------

def test_string_values_are_coerced():
    raw = {
        "charges": {
            "applied_weight_amount": "99.5",
            "applied_weight_amount_rto": "20.0",
            "cod_charges": "10.0",
        }
    }
    b = total_charges_from_raw(raw)
    assert abs(b.total - 129.5) < 0.0001


# ---------------------------------------------------------------------------
# ChargeBreakdown dataclass properties
# ---------------------------------------------------------------------------

def test_charge_breakdown_is_frozen():
    b = ChargeBreakdown(forward=10.0, rto=5.0, cod=2.0)
    with pytest.raises((AttributeError, TypeError)):
        b.forward = 99.0  # type: ignore[misc]


def test_charge_breakdown_total_property():
    b = ChargeBreakdown(forward=10.0, rto=5.0, cod=2.0)
    assert b.total == 17.0
