"""MetricsService gRPC handler — Phase 5 SP-1."""
from __future__ import annotations

import grpc

from src.cache.redis import cache_get_bytes, cache_set_bytes, make_key
from src.db.pool import get_pool
from src.grpc.gen.analytics import metrics_pb2, metrics_pb2_grpc
from src.queries.pnl import compute_pnl


class MetricsServicer(metrics_pb2_grpc.MetricsServiceServicer):
    async def GetPnL(
        self,
        request: metrics_pb2.GetPnLRequest,
        context: grpc.aio.ServicerContext,
    ) -> metrics_pb2.PnLResponse:
        cache_key = make_key(
            "pnl",
            request.workspace_id,
            {
                "from_date": request.from_date,
                "to_date": request.to_date,
                "granularity": int(request.granularity),
            },
        )

        cached = await cache_get_bytes(cache_key)
        if cached is not None:
            response = metrics_pb2.PnLResponse()
            response.ParseFromString(cached)
            return response

        async with get_pool().acquire() as conn:
            response = await compute_pnl(conn, request)

        await cache_set_bytes(cache_key, response.SerializeToString())
        return response
