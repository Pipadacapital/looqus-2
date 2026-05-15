"""asyncpg connection pool to Supabase Postgres (the same DB Looqus uses).

The pool is created at app startup and closed on shutdown. queries/pnl.py
acquires connections via `acquire()` for the duration of a single request.
"""
from __future__ import annotations

import os

import asyncpg

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    global _pool
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is not set")
    size = int(os.environ.get("PG_POOL_SIZE", "10"))
    _pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=size)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("asyncpg pool not initialised — did lifespan run?")
    return _pool
