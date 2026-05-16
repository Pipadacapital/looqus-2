"""Strict parity test for /pnl.

Hits both the Looqus endpoint and the Brain endpoint for a fixture
(workspace, from, to, granularity), then walks both JSON trees recursively
and asserts every numeric leaf is within 0.01% (with an absolute floor of
1e-4 for tiny numbers) and every non-numeric leaf is exactly equal.

Prereqs:
  - SP-1 docker stack up (`pnpm infra:up`) — provides Redis
  - Looqus dev server on http://localhost:3000 — pnpm --filter shopify-analytics dev
  - analytics-service on localhost:50051 — uv run uvicorn src.main:app
  - LOOQUS_BEARER env var set to a valid Supabase access token for the
    user that has membership in PARITY_WORKSPACE_SLUG (the parity test
    can't sign in; it borrows a session token).
  - PARITY_WORKSPACE_SLUG, PARITY_FROM, PARITY_TO env vars set to the
    fixture workspace + date range (Shopify-only workspace per spec).
  - NEXT_PUBLIC_BRAIN_PNL_ENABLED=true on the dev server so the page
    bundle is built with the flag on (only needed if hitting /pnl through
    the page — the /api/_brain/pnl proxy works regardless).

Run:
  uv run pytest tests/parity/pnl_test.py -v
"""
from __future__ import annotations

import os
from typing import Any

import httpx
import pytest

FIXTURE_WORKSPACE_SLUG = os.environ.get("PARITY_WORKSPACE_SLUG", "")
FIXTURE_FROM = os.environ.get("PARITY_FROM", "")
FIXTURE_TO = os.environ.get("PARITY_TO", "")
FIXTURE_GRANULARITY = os.environ.get("PARITY_GRANULARITY", "day")

LOOQUS_BASE = os.environ.get("LOOQUS_BASE_URL", "http://localhost:3000")
BEARER = os.environ.get("LOOQUS_BEARER")


def _diff(path: str, a: Any, b: Any, diffs: list[str]) -> None:
    """Walk both trees in lockstep; collect every divergence."""
    if isinstance(a, dict) and isinstance(b, dict):
        keys = set(a) | set(b)
        for k in sorted(keys):
            if k not in a:
                diffs.append(f"{path}.{k}: missing in OLD")
            elif k not in b:
                diffs.append(f"{path}.{k}: missing in NEW")
            else:
                _diff(f"{path}.{k}", a[k], b[k], diffs)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            diffs.append(f"{path}: list length OLD={len(a)} NEW={len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            _diff(f"{path}[{i}]", x, y, diffs)
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        tol = max(1e-4, abs(a) * 1e-4)
        if abs(a - b) > tol:
            diffs.append(f"{path}: OLD={a} NEW={b} delta={b - a}")
    else:
        if a != b:
            diffs.append(f"{path}: OLD={a!r} NEW={b!r}")


@pytest.mark.skipif(
    not BEARER or not FIXTURE_WORKSPACE_SLUG or not FIXTURE_FROM or not FIXTURE_TO,
    reason="parity test requires LOOQUS_BEARER + PARITY_WORKSPACE_SLUG + PARITY_FROM + PARITY_TO env vars",
)
def test_pnl_parity():
    headers = {"Cookie": f"sb-access-token={BEARER}"}
    qs = f"from={FIXTURE_FROM}&to={FIXTURE_TO}&granularity={FIXTURE_GRANULARITY}"

    old_url = f"{LOOQUS_BASE}/api/workspaces/{FIXTURE_WORKSPACE_SLUG}/pnl?{qs}"
    new_url = f"{LOOQUS_BASE}/api/_brain/pnl?slug={FIXTURE_WORKSPACE_SLUG}&{qs}"

    with httpx.Client(headers=headers, timeout=120.0, follow_redirects=False) as client:
        old = client.get(old_url)
        if old.status_code in (307, 401, 403):
            pytest.fail(
                f"OLD endpoint returned {old.status_code} — check LOOQUS_BEARER is a valid "
                f"Supabase session token for a user with membership in {FIXTURE_WORKSPACE_SLUG}"
            )
        old.raise_for_status()

        new = client.get(new_url)
        if new.status_code in (307, 401, 403):
            pytest.fail(f"NEW endpoint returned {new.status_code} — auth/membership issue")
        new.raise_for_status()

    diffs: list[str] = []
    _diff("$", old.json(), new.json(), diffs)
    if diffs:
        msg = "\n  - " + "\n  - ".join(diffs[:50])
        if len(diffs) > 50:
            msg += f"\n  ... and {len(diffs) - 50} more"
        pytest.fail(f"{len(diffs)} parity diff(s):{msg}")
