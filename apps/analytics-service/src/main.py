"""analytics-service — Brain OLAP / metric-engine service.

Phase 5 SP-1 entrypoint: FastAPI app for /health + lifecycle hooks that start
and stop the gRPC server, asyncpg pool, and Redis client. The actual /pnl
computation lives behind the gRPC handler in src/grpc/metrics_service.py.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # gRPC server + asyncpg pool + Redis client are wired in later tasks.
    # For now, the FastAPI app stands alone as a /health server.
    yield


app = FastAPI(title="analytics-service", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "analytics-service"}
