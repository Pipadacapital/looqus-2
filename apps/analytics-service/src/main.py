"""analytics-service — Brain OLAP / metric-engine service."""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from src.db.pool import close_pool, init_pool
from src.grpc.server import start_grpc_server


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_pool()
    grpc_server: object | None = None
    try:
        grpc_server = await start_grpc_server()
        yield
    finally:
        if grpc_server is not None:
            await grpc_server.stop(grace=2.0)
        await close_pool()


app = FastAPI(title="analytics-service", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "analytics-service"}
