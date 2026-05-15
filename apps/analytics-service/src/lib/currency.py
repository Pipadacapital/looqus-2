"""Currency conversion. Port of the EXCHANGE_RATES table + convertCurrency
function inlined in apps/frontend/app/api/workspaces/[slug]/pnl/route.ts
(lines 25-41).

Port verbatim. Do NOT replace with a config table or a runtime FX API —
parity is the rule. When the TS code changes, this file changes in lockstep.

TS source:
    const EXCHANGE_RATES: Record<string, number> = {
      USD: 1,
      INR: 83.5,
      EUR: 0.92,
      GBP: 0.79,
      AUD: 1.53,
      CAD: 1.35,
    }

    function convertCurrency(amount: number, from: string, to: string) {
      if (!from || !to || from === to) return amount
      const fromRate = EXCHANGE_RATES[from] || 1
      const toRate = EXCHANGE_RATES[to] || 1
      return (amount / fromRate) * toRate
    }
"""
from __future__ import annotations

EXCHANGE_RATES: dict[str, float] = {
    "USD": 1.0,
    "INR": 83.5,
    "EUR": 0.92,
    "GBP": 0.79,
    "AUD": 1.53,
    "CAD": 1.35,
}


def convert_currency(amount: float, from_ccy: str, to_ccy: str) -> float:
    """Port of TS convertCurrency(amount, from, to).

    Returns amount unchanged when either currency is falsy or they are equal.
    Unknown currencies fall back to rate 1.0 (TS: EXCHANGE_RATES[x] || 1).
    """
    if not from_ccy or not to_ccy or from_ccy == to_ccy:
        return amount
    from_rate = EXCHANGE_RATES.get(from_ccy) or 1.0
    to_rate = EXCHANGE_RATES.get(to_ccy) or 1.0
    return (amount / from_rate) * to_rate
