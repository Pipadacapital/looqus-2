"""grpc.aio server bootstrap — registers MetricsService and listens on $GRPC_PORT."""
from __future__ import annotations

import os

import grpc

from src.grpc.gen.analytics import metrics_pb2_grpc
from src.grpc.metrics_service import MetricsServicer


async def start_grpc_server() -> grpc.aio.Server:
    server = grpc.aio.server()
    metrics_pb2_grpc.add_MetricsServiceServicer_to_server(MetricsServicer(), server)
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("GRPC_PORT", "50051"))
    server.add_insecure_port(f"{host}:{port}")
    await server.start()
    return server
