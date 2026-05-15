"""Redis cache helper for analytics-service.

Per spec Section 3:
  - Key format: analytics:<rpc>:<workspace_id>:<sha256(canonical_request)>
  - TTL: 60 seconds (Phase 5.4)
  - Value: raw bytes (typically a serialised proto), no JSON round-trip
  - Failure mode: log a warning, skip cache. Never fail a request because
    Redis is down.
  - invalidate_workspace(ws_id) deletes every key under the workspace via
    SCAN (non-blocking) for the eventual Kafka-driven invalidation.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any

import redis.asyncio as redis_asyncio

CACHE_TTL_SECONDS = 60

_log = logging.getLogger(__name__)
_client: redis_asyncio.Redis | None = None


async def init_client() -> redis_asyncio.Redis:
    global _client
    url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
    _client = redis_asyncio.from_url(url)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def make_key(rpc: str, workspace_id: str, request_dict: dict[str, Any]) -> str:
    canonical = json.dumps(request_dict, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"analytics:{rpc}:{workspace_id}:{digest}"


async def cache_get_bytes(key: str) -> bytes | None:
    if _client is None:
        return None
    try:
        return await _client.get(key)
    except Exception as exc:  # noqa: BLE001
        _log.warning("redis get failed: %s", exc)
        return None


async def cache_set_bytes(key: str, value: bytes, ttl: int = CACHE_TTL_SECONDS) -> None:
    if _client is None:
        return
    try:
        await _client.set(key, value, ex=ttl)
    except Exception as exc:  # noqa: BLE001
        _log.warning("redis set failed: %s", exc)


async def invalidate_workspace(workspace_id: str) -> int:
    """Delete every analytics:*:<workspace_id>:* key. Returns count deleted."""
    if _client is None:
        return 0
    deleted = 0
    try:
        async for key in _client.scan_iter(match=f"analytics:*:{workspace_id}:*"):
            await _client.delete(key)
            deleted += 1
    except Exception as exc:  # noqa: BLE001
        _log.warning("redis invalidate failed: %s", exc)
    return deleted
