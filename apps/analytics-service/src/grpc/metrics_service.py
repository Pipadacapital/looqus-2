"""MetricsService gRPC handler — Phase 5 SP-1 stub.

GetPnL returns an empty PnLResponse for now. The real implementation lands
in Task 11, after the shared calc lib + queries/pnl.py are in place.
"""
from __future__ import annotations

import grpc

from src.grpc.gen.analytics import metrics_pb2, metrics_pb2_grpc


class MetricsServicer(metrics_pb2_grpc.MetricsServiceServicer):
    async def GetPnL(
        self,
        request: metrics_pb2.GetPnLRequest,
        context: grpc.aio.ServicerContext,
    ) -> metrics_pb2.PnLResponse:
        # TODO(Phase 5 SP-1, Task 11): replace with real /pnl computation.
        return metrics_pb2.PnLResponse(rows=[], currency="USD")
