"""MetricsService gRPC handler — Phase 5 SP-1."""
from __future__ import annotations

import grpc

from src.db.pool import get_pool
from src.grpc.gen.analytics import metrics_pb2, metrics_pb2_grpc
from src.queries.pnl import compute_pnl


class MetricsServicer(metrics_pb2_grpc.MetricsServiceServicer):
    async def GetPnL(
        self,
        request: metrics_pb2.GetPnLRequest,
        context: grpc.aio.ServicerContext,
    ) -> metrics_pb2.PnLResponse:
        async with get_pool().acquire() as conn:
            return await compute_pnl(conn, request)
