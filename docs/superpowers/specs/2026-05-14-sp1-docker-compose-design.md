# SP-1 — Local Docker Compose Stack Design

**Date:** 2026-05-14
**Status:** Approved (pending user review of this spec)
**Phase:** 1 (Data Plane Foundation), Sub-Project 1 of 4
**Source plan section:** `BRAIN_PHASED_PLAN.md` Phase 1.1
**Branch:** TBD (off `main` after Phase 0 PRs merge; named `phase-1-sp1-docker-compose`)

---

## Summary

Stand up the full local data-plane stack as a single `docker-compose` file plus minimal supporting config. No service code, no schemas, no contracts — only the runtime environment that subsequent SP-2/SP-3/SP-4 sub-projects (and Phases 2+) will run against.

The stack provisions everything Phase 1–8 will eventually need so that future sub-projects don't have to alter infra. LocalStack is deliberately omitted (deferred to Phase 2 or Phase 8 when SES/EventBridge mocking is actually needed).

---

## Phase 1 decomposition (4 sub-projects)

This spec covers SP-1 only. The other three are tracked here for context:

| SP | Subject | Plan section | Status |
|---|---|---|---|
| **SP-1** | **Local Docker Compose stack** | **1.1** | **This spec** |
| SP-2 | Both DB schemas — Postgres mirror in core-service + ClickHouse in analytics-service (partial service scaffolds) | 1.2 + 1.3 | Spec to follow |
| SP-3 | Wire contracts — Protobuf gRPC services + Avro Kafka schemas + Kafka topic declarations | 1.4 + 1.5 | Spec to follow |
| SP-4 | Multi-tenancy helpers — `pylibs/brain_clickhouse`, `pylibs/brain_db`, gRPC client middleware | 1.6 | Spec to follow |

---

## Decisions log

| # | Decision | Choice | Reasoning |
|---|---|---|---|
| Q1 | Phase 1 decomposition | **B** — 4 sub-projects (Docker Compose / schemas / contracts / tenancy) | Logical grouping; Docker stays one cohesive sub-project; schemas paired (both DBs in one) |
| Q2 | Kafka stack | **C** — Confluent KRaft mode (no Zookeeper) | Real Kafka semantics matching MSK in prod, single container, smaller footprint than Confluent + ZK |
| Q3 | Schema Registry | **A** — Confluent Schema Registry | Standard pairing with Confluent Kafka; wire format matches AWS Glue Schema Registry → dev/prod parity |
| Q4 | Admin UIs | **B** — `kafka-ui` + `adminer` (built-in for ClickHouse and MinIO) | Kafka without a UI is genuinely painful; adminer is zero-config Postgres GUI |
| Q5 | LocalStack | **B** — skip entirely from SP-1 | Heavy 600MB image for services not needed until Phase 2 (EventBridge) and Phase 8 (SES); add later when actually needed |
| Q6 | Convenience commands | **B** — pnpm scripts at root | Stays inside pnpm-land; no second command surface; Makefile deferred per Phase 0 deviation |

---

## Section 1 — Container inventory (8 services)

| Service | Image | Host port(s) | Purpose |
|---|---|---|---|
| `postgres` | `postgres:16` | `5432` | OLTP system-of-record. Mirrors Supabase locally. |
| `clickhouse` | `clickhouse/clickhouse-server:24.3` | `8123` (HTTP/Play UI), `9000` (TCP) | OLAP store. |
| `kafka` | `confluentinc/cp-kafka:7.7.1` | `9092` (broker), `9093` (controller) | Single-broker, KRaft mode (no Zookeeper). |
| `schema-registry` | `confluentinc/cp-schema-registry:7.7.1` | `8081` | Avro schema versioning + compatibility checks. |
| `redis` | `redis:7-alpine` | `6379` | Hot-cache layer. |
| `minio` | `minio/minio:latest` | `9100` (S3 API), `9101` (console) | S3-compatible local object store. **Ports bumped from MinIO defaults (9000/9001) to avoid collision with ClickHouse TCP 9000.** |
| `kafka-ui` | `provectuslabs/kafka-ui:latest` | `8080` | Web UI for Kafka topics + Schema Registry. |
| `adminer` | `adminer:latest` | `8082` | Postgres web GUI. |

**Resource estimate:** ~3GB RAM idle, ~4GB during active use.

---

## Section 2 — File layout

```
infra/
├── README.md                     ← already exists from Phase 0
├── docker-compose.yaml           ← single file, all 8 services
├── verify.sh                     ← bash script automating non-browser checks (Section 6)
├── kafka/
│   └── server.properties         ← KRaft-mode config (controller+broker combined)
├── clickhouse/
│   ├── config.xml                ← minimal overrides
│   └── users.xml                 ← default user, no password (local-dev only)
└── schema-registry/              ← (no files; configured via env in docker-compose)
```

Plus root-level edits:
- `package.json` (root) — add `infra:up`, `infra:down`, `infra:logs`, `infra:ps`, `infra:reset` scripts
- `.gitignore` — defensive add of `infra/data/` (we use named Docker volumes, not bind mounts, so this is precaution only)

**Why `kafka/` and `clickhouse/` get subdirectories:** these images expect mounted config files; inlining them in `docker-compose.yaml` makes the compose file ugly. Schema Registry and Redis are env-config-only.

---

## Section 3 — Networking, ports, volumes

**Network:** single bridge network `brain-local` so containers resolve each other by service name (e.g. `kafka` → broker from inside `schema-registry`).

**Port binding:** all bound to `127.0.0.1` (loopback only). No `0.0.0.0` exposure.

| Service | Host port | Container port |
|---|---|---|
| postgres | 5432 | 5432 |
| clickhouse (HTTP/Play UI) | 8123 | 8123 |
| clickhouse (TCP) | 9000 | 9000 |
| kafka | 9092 | 9092 |
| schema-registry | 8081 | 8081 |
| redis | 6379 | 6379 |
| minio (S3 API) | 9100 | 9000 |
| minio (console) | 9101 | 9001 |
| kafka-ui | 8080 | 8080 |
| adminer | 8082 | 8080 |

**Volumes:** Docker named volumes (not bind mounts), one per stateful service:
- `brain-postgres-data`
- `brain-clickhouse-data`
- `brain-kafka-data`
- `brain-redis-data`
- `brain-minio-data`

`pnpm infra:reset` runs `docker compose down -v` to wipe these.

---

## Section 4 — Init / first-boot behavior

| Service | First-boot behavior |
|---|---|
| postgres | Creates `postgres` superuser + a `brain` database via `POSTGRES_DB=brain`. No tables (added in SP-2 via Prisma). |
| clickhouse | Creates `default` user (no password). No databases (added in SP-2). |
| kafka | KRaft cluster format runs once on first boot (single-node, single-broker), then starts. **Auto-topic creation disabled** (`auto.create.topics.enable=false`) — topics created explicitly in SP-3. |
| schema-registry | Connects to kafka, creates internal `_schemas` topic, ready to register. No schemas pre-registered. |
| redis | Default config, no auth, no persisted keys. |
| minio | Creates root user `minioadmin` / `minioadmin` (local-dev only). **No buckets pre-created** — buckets land when ingestion-service needs them in Phase 2. |
| kafka-ui | Reads broker `kafka:9092` and registry `http://schema-registry:8081`, ready to browse. |
| adminer | Stateless. Open `http://localhost:8082`, connect to `postgres` host with creds. |

**Health checks** in `docker-compose.yaml`:

| Service | Healthcheck |
|---|---|
| postgres | `pg_isready -U postgres` |
| kafka | `kafka-broker-api-versions --bootstrap-server localhost:9092` |
| schema-registry | `curl -f http://localhost:8081/subjects` |
| clickhouse | `curl -f http://localhost:8123/ping` |

**Boot dependency graph:** `schema-registry` `depends_on: kafka (healthy)`. `kafka-ui` `depends_on: kafka (healthy), schema-registry (healthy)`. Everything else starts independently.

**No seed data, no auto-migrations** — those belong to downstream sub-projects.

---

## Section 5 — Developer UX

Add to root `package.json` `"scripts"`:

```json
"infra:up":     "docker compose -f infra/docker-compose.yaml up -d",
"infra:down":  "docker compose -f infra/docker-compose.yaml down",
"infra:logs":  "docker compose -f infra/docker-compose.yaml logs -f",
"infra:ps":    "docker compose -f infra/docker-compose.yaml ps",
"infra:reset": "docker compose -f infra/docker-compose.yaml down -v && pnpm infra:up"
```

Daily flow:
- Start of day: `pnpm infra:up`
- Status: `pnpm infra:ps`
- Logs (one service): `pnpm infra:logs kafka`
- Wipe: `pnpm infra:reset`
- End of day: `pnpm infra:down` (or just leave it — idle ~3GB RAM)

URL cheat-sheet (lands in `infra/README.md`):
```
Postgres:        psql postgres://postgres:postgres@localhost:5432/brain
ClickHouse Play: http://localhost:8123/play
Kafka UI:        http://localhost:8080
Schema Registry: http://localhost:8081/subjects
MinIO Console:   http://localhost:9101  (login: minioadmin / minioadmin)
Adminer:         http://localhost:8082  (system: PostgreSQL, server: postgres, user: postgres, db: brain)
```

---

## Section 6 — Verification plan

After `pnpm infra:up`, all of these must pass:

| # | Check | How | Pass criterion |
|---|---|---|---|
| 1 | All 8 containers running | `pnpm infra:ps` | All show `Up` (or `Up (healthy)` for the four with healthchecks) |
| 2 | Postgres reachable + `brain` db exists | `psql postgres://postgres:postgres@localhost:5432/brain -c '\l'` | Lists `brain` database |
| 3 | ClickHouse reachable | `curl -s http://localhost:8123/ping` | `Ok.` |
| 4 | ClickHouse Play UI | Browser `http://localhost:8123/play` | SQL editor renders |
| 5 | Kafka responsive | `docker compose ... exec kafka kafka-topics --bootstrap-server localhost:9092 --list` | Empty list, no error |
| 6 | Schema Registry | `curl -s http://localhost:8081/subjects` | `[]` |
| 7 | Redis | `docker compose ... exec redis redis-cli ping` | `PONG` |
| 8 | MinIO | `curl -s -o /dev/null -w "%{http_code}" http://localhost:9100/minio/health/live` | `200` |
| 9 | Kafka UI | Browser `http://localhost:8080` | Lists `kafka` cluster, no errors |
| 10 | Adminer | Browser `http://localhost:8082`, connect to postgres | Successful connect, lists `brain` |
| 11 | Reset works | `pnpm infra:reset` then re-run #2 | Same outcome (fresh empty `brain` db) |
| 12 | Restart survives | `docker compose ... restart` | All come back healthy |

`infra/verify.sh` automates checks 1–8. Browser checks (4, 9, 10) and reset/restart (11, 12) stay manual.

---

## Section 7 — Risks & rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| Port collision with something already on user's laptop | Medium | Document the port list in `infra/README.md`; allow override via `.env` file (`POSTGRES_HOST_PORT=5433` etc.) |
| Docker Desktop not running or not installed | Medium | `infra/README.md` lists Docker Desktop as a prerequisite; `pnpm infra:up` fails with a clear error if not running |
| KRaft mode cluster-ID mismatch on first boot | Low | KRaft init runs once on empty volume; subsequent starts read existing ID. If volume corrupts → `pnpm infra:reset` |
| Disk consumption grows over time | Low | Named volumes inspectable (`docker volume ls`, `docker system df`) and prunable (`docker volume prune`) |
| MinIO data lost on `infra:reset` | Expected | Documented behavior — `infra:reset` is destructive by design |
| Schema Registry `BACKWARD` compatibility default trips us up later | Low | SP-3 explicitly sets compatibility per topic when registering; SP-1 registers nothing |
| Confluent Docker Hub rate limits | Low | Document Docker Hub auth in README if it bites; not pre-emptively required |
| User wants to roll back the sub-project | Trivial | `git revert <merge-commit>`; `docker volume prune` reclaims space |

---

## Open questions / explicit non-decisions

- **Postgres extensions** (pgvector, pg_trgm, etc.) — none enabled in SP-1. SP-2 will enable specific extensions when Prisma migrations need them.
- **ClickHouse cluster mode / Keeper** — single-node only locally. Production (Phase 11) will use ClickHouse Cloud or Altinity Operator on EKS.
- **Per-developer port overrides via `.env`** — designed in (Section 7) but the `.env` file itself isn't shipped; users create it on demand if they hit collisions.
- **Backups / snapshots** — N/A locally. Production Postgres uses Supabase backups; ClickHouse uses S3 backups in Phase 11.
- **Resource limits** — none set; rely on Docker Desktop's host-level limits.

---

## Definition of done

- [ ] `pnpm infra:up` brings up all 8 services from a clean state
- [ ] `bash infra/verify.sh` exits 0 (all 8 automated checks green)
- [ ] Browser checks (4, 9, 10) work (manual)
- [ ] `pnpm infra:reset` reproduces the clean state
- [ ] PR opened, CI green (CI doesn't run docker — verify.sh is local-only)
- [ ] User squash-merges to `main`
- [ ] Fresh `git pull` on `main` followed by `pnpm install && pnpm infra:up && bash infra/verify.sh` reproduces working stack
