#!/usr/bin/env bash
# Generates Python gRPC stubs from protos/. Run from repo root.
# Node clients use @grpc/proto-loader's dynamic loading — no codegen needed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$REPO_ROOT/apps/analytics-service/src/grpc/gen"

mkdir -p "$OUT_DIR/analytics"

cd "$REPO_ROOT/apps/analytics-service"

uv run python -m grpc_tools.protoc \
  --proto_path="$REPO_ROOT" \
  --python_out="$OUT_DIR/.." \
  --grpc_python_out="$OUT_DIR/.." \
  "$REPO_ROOT/protos/analytics/metrics.proto"

# grpcio-tools generates files at <out>/protos/analytics/metrics_pb2*.py.
# Move them to the expected gen/analytics/ location so imports stay clean.
mv "$OUT_DIR/../protos/analytics/metrics_pb2.py" "$OUT_DIR/analytics/metrics_pb2.py"
mv "$OUT_DIR/../protos/analytics/metrics_pb2_grpc.py" "$OUT_DIR/analytics/metrics_pb2_grpc.py"
rm -rf "$OUT_DIR/../protos"

# The generated _grpc.py uses `from protos.analytics import metrics_pb2`.
# Rewrite it to `from src.grpc.gen.analytics import metrics_pb2` so the import
# path matches the file layout.
sed -i.bak 's|^from protos\.analytics import metrics_pb2|from src.grpc.gen.analytics import metrics_pb2|' \
  "$OUT_DIR/analytics/metrics_pb2_grpc.py"
rm "$OUT_DIR/analytics/metrics_pb2_grpc.py.bak"

# Make the gen tree importable.
touch "$OUT_DIR/__init__.py" "$OUT_DIR/analytics/__init__.py"

echo "ok — generated metrics_pb2.py and metrics_pb2_grpc.py"
