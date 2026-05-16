# Skeleton-stage image. A monorepo-aware multi-stage build lands when
# analytics-service gets ingestion/Kafka wiring (later phase).
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml ./
RUN uv sync --no-install-project
COPY . .
EXPOSE 8000 50051
CMD ["uv", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
