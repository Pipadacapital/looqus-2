"""Unit tests for src/cache/redis.py — key generation + failure-mode behaviour."""
from __future__ import annotations

import pytest

from src.cache.redis import (
    cache_get_bytes,
    cache_set_bytes,
    invalidate_workspace,
    make_key,
)


def test_make_key_deterministic():
    a = make_key("pnl", "ws-1", {"from": "2024-01-01", "to": "2024-01-31"})
    b = make_key("pnl", "ws-1", {"to": "2024-01-31", "from": "2024-01-01"})
    assert a == b, "key must be order-independent (canonical JSON sort)"


def test_make_key_distinguishes_workspaces():
    a = make_key("pnl", "ws-1", {"from": "2024-01-01"})
    b = make_key("pnl", "ws-2", {"from": "2024-01-01"})
    assert a != b


def test_make_key_distinguishes_rpcs():
    a = make_key("pnl", "ws-1", {"from": "2024-01-01"})
    b = make_key("waterfall", "ws-1", {"from": "2024-01-01"})
    assert a != b


def test_make_key_format():
    k = make_key("pnl", "ws-1", {"from": "2024-01-01"})
    parts = k.split(":")
    assert parts[0] == "analytics"
    assert parts[1] == "pnl"
    assert parts[2] == "ws-1"
    assert len(parts[3]) == 64  # sha256 hex


@pytest.mark.asyncio
async def test_cache_get_returns_none_when_client_uninitialised():
    # No init_client() called => _client is None => functions return safely.
    assert await cache_get_bytes("any") is None
    await cache_set_bytes("any", b"x")  # must not raise
    assert await invalidate_workspace("ws-1") == 0
