"""analytics-service — Brain OLAP / metric-engine service."""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from src.grpc.server import start_grpc_server


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    grpc_server = await start_grpc_server()
    try:
        yield
    finally:
        await grpc_server.stop(grace=2.0)


app = FastAPI(title="analytics-service", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "analytics-service"}
