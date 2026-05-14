# infra/

Infrastructure as code: the local Docker Compose stack today, AWS CDK in Phase 11.

## Local Docker Compose stack (Phase 1 SP-1)

`docker-compose.yaml` brings up 8 services for local development of the Brain monorepo. Run via the `pnpm infra:*` scripts at repo root.

### Prerequisites

- **Docker Desktop** (macOS/Windows) or **Docker Engine + Compose v2** (Linux). Install: https://www.docker.com/products/docker-desktop/
- **pnpm 9.15.4+** — already set up by Phase 0
- **~4GB free RAM** for the running stack (~3GB idle, ~4GB during use)
- **10 free TCP ports** on `127.0.0.1` (see URL cheat-sheet below)

### Daily commands

```bash
pnpm infra:up      # start all 8 services in background
pnpm infra:ps      # show status
pnpm infra:logs    # tail all logs
pnpm infra:logs kafka  # tail just one service
pnpm infra:down    # stop (data persists)
pnpm infra:reset   # destroy volumes and re-up (full wipe)
```

### Verification

```bash
bash infra/verify.sh
```

Runs 8 automated health checks against the running stack. Exits 0 on green, 1 on first failure with diagnostic detail.

### URL cheat-sheet

| Service | URL / connection string | Notes |
|---|---|---|
| Postgres | `postgres://postgres:postgres@localhost:5432/brain` | psql or any client |
| ClickHouse Play UI | http://localhost:8123/play | Built-in SQL editor |
| ClickHouse TCP | `tcp://default@localhost:9000` | clickhouse-client |
| Kafka broker | `localhost:9092` | PLAINTEXT |
| Schema Registry | http://localhost:8081/subjects | List all schemas |
| Redis | `redis://localhost:6379` | redis-cli |
| MinIO S3 API | http://localhost:9100 | minioadmin / minioadmin |
| MinIO Console | http://localhost:9101 | minioadmin / minioadmin |
| Kafka UI | http://localhost:8080 | Topics + Schema Registry browser |
| Adminer | http://localhost:8082 | system: PostgreSQL, server: postgres, user: postgres, db: brain |

### Troubleshooting

**`Cannot connect to the Docker daemon`**
Docker Desktop isn't running. Start it from your menu bar / system tray.

**Port already allocated**
Another process is using one of the host ports. Find it with `lsof -nP -iTCP:<port> -sTCP:LISTEN` and either stop it or override the host port via Docker Compose env (e.g. `POSTGRES_HOST_PORT=5433` and add `${POSTGRES_HOST_PORT:-5432}:5432` to the service's port mapping — currently we ship hard-coded ports; override support lands when first user hits a collision).

**Kafka stuck in `Restarting`**
Usually KRaft cluster ID mismatch from a prior partial start. Fix with `pnpm infra:reset` (wipes Kafka volume).

**ClickHouse permission errors on macOS**
Docker Desktop file-sharing quirk. Try `pnpm infra:reset`. If persistent, check Docker Desktop → Settings → Resources → File Sharing.

**`brain-*-data` volumes consuming disk**
Inspect with `docker volume ls` and `docker system df`. Reclaim with `docker volume prune` (after `pnpm infra:down`).

### What's deferred

- **LocalStack** (SES + EventBridge) — added when notifications-service (Phase 8) and ingestion-service (Phase 2) actually need them
- **Postgres extensions** (pgvector, pg_trgm) — enabled via Prisma migrations in SP-2 when first needed
- **ClickHouse Keeper / clustering** — single-node only locally; production handles HA via ClickHouse Cloud or Altinity Operator (Phase 11)
- **CDK / AWS infra** — Phase 11

## AWS CDK (Phase 11)

Will hold:
- `stacks/` — network, compute (EKS), data (RDS, ClickHouse Cloud, Redis), kafka (MSK), storage (S3, CloudFront), observability, security
- `k8s/` — Kubernetes manifests synced via ArgoCD
- `bin/` — CDK entrypoint
