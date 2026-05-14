# SP-1 — Local Docker Compose Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full local data-plane Docker Compose stack (8 services) with `pnpm infra:up`, verifiable via `bash infra/verify.sh`.

**Architecture:** Single `infra/docker-compose.yaml` defines 8 services on a shared bridge network, all bound to `127.0.0.1`. Stateful services use named Docker volumes. Two services need mounted config files (Kafka KRaft, ClickHouse minimal overrides) — those live in `infra/kafka/` and `infra/clickhouse/`. Five `infra:*` pnpm scripts at root wrap the docker compose commands. A `verify.sh` script automates the 8 non-browser health checks.

**Tech Stack:** Docker Compose v2, Confluent Platform 7.7.1 (Kafka KRaft + Schema Registry), Postgres 16, ClickHouse 24.3, Redis 7, MinIO, kafka-ui, adminer.

**Spec:** `docs/superpowers/specs/2026-05-14-sp1-docker-compose-design.md`

**Branch:** `phase-1-sp1-docker-compose` (off `main`, **after** both Phase 0 PRs have been merged to main)

---

## Pre-flight environment notes (verified at planning time)

- pnpm 9.15.4 already installed (set up during Phase 0 at `~/.npm-global/bin/pnpm`; PATH export still needed in non-interactive shells: `export PATH="$HOME/.npm-global/bin:$PATH"`)
- Node 22.19.0
- macOS Darwin 25.4.0 — Docker Desktop is the expected Docker runtime
- Repo root: `/Users/kushalyadav/looqus-2/looqus`
- After Phase 0 merge, the working layout is `apps/frontend/` (Next.js app), `apps/`, `packages/`, `pylibs/`, `protos/`, `infra/`, `tools/`, `docs/` (all with READMEs)
- `infra/README.md` already exists (one-paragraph stub from Phase 0 Task 3); this plan replaces it with a fuller version in Task 4

---

## File Structure (what each new file is responsible for)

| Path | Purpose |
|---|---|
| `infra/docker-compose.yaml` (new) | The stack definition — 8 services, network, volumes, healthchecks |
| `infra/kafka/server.properties` (new) | Confluent Kafka KRaft-mode configuration (controller+broker combined-mode) |
| `infra/clickhouse/config.xml` (new) | ClickHouse server config — minimal overrides (just listen_host=0.0.0.0) |
| `infra/clickhouse/users.xml` (new) | ClickHouse users — `default` user, no password (local-dev only) |
| `infra/verify.sh` (new) | Bash script automating 8 non-browser health checks; exits 0 on green |
| `infra/README.md` (modified) | Replace Phase 0 stub with prerequisites, URL cheat-sheet, troubleshooting |
| `package.json` (root, modified) | Add `infra:up`, `infra:down`, `infra:logs`, `infra:ps`, `infra:reset` scripts |

That's 7 files total — 5 new, 2 modified.

---

## Task 0: Pre-flight — verify Phase 0 merged, install Docker, branch setup

**Files:** none (preparation only)

- [ ] **Step 1: Verify Phase 0 PRs have been merged to main**

```bash
git fetch origin
git log origin/main --oneline | grep -E "Phase 0|monorepo restructure" | head -3
```

Expected: at least one commit related to the Phase 0 monorepo restructure appears on `origin/main`. If nothing appears, STOP — the prerequisite hasn't landed yet. Wait for the user to merge PR 1 (`kushal-node` → `main`) and PR 2 (`phase-0-monorepo` → `main`) on GitHub.

- [ ] **Step 2: Confirm working tree is clean and on main**

```bash
git checkout main
git pull origin main
git status --short
```

Expected: switched to main, pulled latest, working tree clean.

- [ ] **Step 3: Verify the Phase 0 layout exists**

```bash
test -d apps/frontend && test -d infra && test -f infra/README.md && test -f pnpm-workspace.yaml && test -f turbo.json && echo "phase 0 layout ok"
```

Expected: `phase 0 layout ok`. If any test fails, STOP — Phase 0 didn't fully land.

- [ ] **Step 4: Verify Docker is installed and the daemon is running**

```bash
docker --version && docker compose version && docker info > /dev/null && echo "docker ok"
```

Expected: prints Docker and Compose versions, then `docker ok`. If `docker info` errors with "Cannot connect to the Docker daemon", STOP and ask the user to start Docker Desktop.

- [ ] **Step 5: Verify pnpm is on PATH**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm --version
```

Expected: prints `9.15.4` (or compatible).

- [ ] **Step 6: Create the SP-1 branch off main**

```bash
git checkout -b phase-1-sp1-docker-compose
git status --short
```

Expected: switched to new branch, status empty.

- [ ] **Step 7: Verify required ports are free**

The stack will bind 5432, 8123, 9000, 9092, 8081, 6379, 9100, 9101, 8080, 8082 to localhost. Check none are in use:

```bash
for p in 5432 8123 9000 9092 8081 6379 9100 9101 8080 8082; do
  lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | head -1
done
echo "port scan complete"
```

Expected: no `LISTEN` lines printed (just the `port scan complete` summary). If any port is in use, STOP and report which port + which process owns it. Common culprit: a system Postgres on 5432.

---

## Task 1: Create docker-compose.yaml + Kafka & ClickHouse config files (Commit 1)

**Files:**
- Create: `infra/docker-compose.yaml`
- Create: `infra/kafka/server.properties`
- Create: `infra/clickhouse/config.xml`
- Create: `infra/clickhouse/users.xml`

This task adds services to the compose file incrementally and verifies each one before moving on. All 8 services land in a single commit at the end.

- [ ] **Step 1: Create the Kafka KRaft properties file**

Write to `infra/kafka/server.properties`:

```properties
# KRaft single-node combined-mode (controller + broker)
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@localhost:9093

# Listeners
listeners=PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
inter.broker.listener.name=PLAINTEXT
controller.listener.names=CONTROLLER
listener.security.protocol.map=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
advertised.listeners=PLAINTEXT://kafka:9092

# Single-broker dev settings
offsets.topic.replication.factor=1
transaction.state.log.replication.factor=1
transaction.state.log.min.isr=1
default.replication.factor=1
min.insync.replicas=1
auto.create.topics.enable=false

# Storage
log.dirs=/var/lib/kafka/data
```

- [ ] **Step 2: Create the ClickHouse config override**

Write to `infra/clickhouse/config.xml`:

```xml
<?xml version="1.0"?>
<clickhouse>
    <listen_host>0.0.0.0</listen_host>
    <logger>
        <level>warning</level>
    </logger>
</clickhouse>
```

- [ ] **Step 3: Create the ClickHouse users override**

Write to `infra/clickhouse/users.xml`:

```xml
<?xml version="1.0"?>
<clickhouse>
    <users>
        <default>
            <password></password>
            <networks>
                <ip>::/0</ip>
            </networks>
            <profile>default</profile>
            <quota>default</quota>
            <access_management>1</access_management>
        </default>
    </users>
</clickhouse>
```

- [ ] **Step 4: Create initial docker-compose.yaml shell**

Write to `infra/docker-compose.yaml`:

```yaml
name: brain-local

networks:
  brain-local:
    driver: bridge

volumes:
  brain-postgres-data:
  brain-clickhouse-data:
  brain-kafka-data:
  brain-redis-data:
  brain-minio-data:

services:

  postgres:
    image: postgres:16
    container_name: brain-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: brain
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - brain-postgres-data:/var/lib/postgresql/data
    networks:
      - brain-local
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d brain"]
      interval: 5s
      timeout: 3s
      retries: 10

  clickhouse:
    image: clickhouse/clickhouse-server:24.3
    container_name: brain-clickhouse
    restart: unless-stopped
    ports:
      - "127.0.0.1:8123:8123"
      - "127.0.0.1:9000:9000"
    volumes:
      - brain-clickhouse-data:/var/lib/clickhouse
      - ./clickhouse/config.xml:/etc/clickhouse-server/config.d/local.xml:ro
      - ./clickhouse/users.xml:/etc/clickhouse-server/users.d/local.xml:ro
    networks:
      - brain-local
    ulimits:
      nofile:
        soft: 262144
        hard: 262144
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8123/ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  kafka:
    image: confluentinc/cp-kafka:7.7.1
    container_name: brain-kafka
    restart: unless-stopped
    ports:
      - "127.0.0.1:9092:9092"
    environment:
      CLUSTER_ID: brain-local-cluster-1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_NODE_ID: 1
      KAFKA_CONTROLLER_QUORUM_VOTERS: "1@kafka:9093"
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: "PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT"
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_DEFAULT_REPLICATION_FACTOR: 1
      KAFKA_MIN_INSYNC_REPLICAS: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"
    volumes:
      - brain-kafka-data:/var/lib/kafka/data
    networks:
      - brain-local
    healthcheck:
      test: ["CMD-SHELL", "kafka-broker-api-versions --bootstrap-server localhost:9092 > /dev/null"]
      interval: 10s
      timeout: 5s
      retries: 15

  schema-registry:
    image: confluentinc/cp-schema-registry:7.7.1
    container_name: brain-schema-registry
    restart: unless-stopped
    depends_on:
      kafka:
        condition: service_healthy
    ports:
      - "127.0.0.1:8081:8081"
    environment:
      SCHEMA_REGISTRY_HOST_NAME: schema-registry
      SCHEMA_REGISTRY_LISTENERS: http://0.0.0.0:8081
      SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: PLAINTEXT://kafka:9092
      SCHEMA_REGISTRY_KAFKASTORE_TOPIC: _schemas
    networks:
      - brain-local
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8081/subjects"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: brain-redis
    restart: unless-stopped
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - brain-redis-data:/data
    networks:
      - brain-local
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  minio:
    image: minio/minio:latest
    container_name: brain-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "127.0.0.1:9100:9000"
      - "127.0.0.1:9101:9001"
    volumes:
      - brain-minio-data:/data
    networks:
      - brain-local
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 5

  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    container_name: brain-kafka-ui
    restart: unless-stopped
    depends_on:
      kafka:
        condition: service_healthy
      schema-registry:
        condition: service_healthy
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      KAFKA_CLUSTERS_0_NAME: brain-local
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092
      KAFKA_CLUSTERS_0_SCHEMAREGISTRY: http://schema-registry:8081
    networks:
      - brain-local

  adminer:
    image: adminer:latest
    container_name: brain-adminer
    restart: unless-stopped
    ports:
      - "127.0.0.1:8082:8080"
    environment:
      ADMINER_DEFAULT_SERVER: postgres
    networks:
      - brain-local
```

- [ ] **Step 5: Bring up the full stack and let it stabilize**

```bash
docker compose -f infra/docker-compose.yaml up -d
sleep 15
docker compose -f infra/docker-compose.yaml ps
```

Expected: all 8 services show `Up` or `Up (healthy)`. Schema Registry and Kafka UI may take 20-30 more seconds to reach healthy because of `depends_on`. If anything shows `Restarting` or `Exit`, look at its logs:

```bash
docker compose -f infra/docker-compose.yaml logs <service-name> | tail -30
```

If Kafka shows config errors, double-check the env vars in step 4. If ClickHouse complains about volume permissions, that's a known macOS/Docker Desktop quirk — usually resolved by `docker compose down -v` and trying again.

- [ ] **Step 6: Smoke-test each service one-by-one**

```bash
# Postgres
psql postgres://postgres:postgres@localhost:5432/brain -c '\l' | head -10
# Expected: lists "brain" database

# ClickHouse
curl -s http://localhost:8123/ping
# Expected: Ok.

# Kafka (use the kafka-topics CLI inside the container)
docker compose -f infra/docker-compose.yaml exec kafka kafka-topics --bootstrap-server localhost:9092 --list
# Expected: empty output (no topics yet) plus exit code 0

# Schema Registry
curl -s http://localhost:8081/subjects
# Expected: []

# Redis
docker compose -f infra/docker-compose.yaml exec redis redis-cli ping
# Expected: PONG

# MinIO health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9100/minio/health/live
# Expected: 200
```

If any check fails, STOP and diagnose. Do NOT proceed to commit if the stack isn't fully green.

- [ ] **Step 7: Verify the four healthchecks report healthy**

```bash
docker compose -f infra/docker-compose.yaml ps --format "table {{.Name}}\t{{.Status}}"
```

Expected: `brain-postgres`, `brain-clickhouse`, `brain-kafka`, `brain-schema-registry` all show `Up X minutes (healthy)`. (Other services don't have healthchecks defined and just show `Up`.)

- [ ] **Step 8: Bring the stack down (we'll re-up via pnpm in the next task)**

```bash
docker compose -f infra/docker-compose.yaml down
```

Expected: all 8 containers stop and remove. Volumes persist.

- [ ] **Step 9: Commit**

```bash
git add infra/docker-compose.yaml infra/kafka/server.properties infra/clickhouse/config.xml infra/clickhouse/users.xml
git status --short  # confirm what's staged
git commit -m "$(cat <<'EOF'
feat(infra): add local Docker Compose stack with 8 services

Phase 1 SP-1: spin up the full local data-plane stack via a single
docker-compose file:

- postgres:16             OLTP (mirrors Supabase)
- clickhouse 24.3         OLAP store
- kafka 7.7.1 (KRaft)     single-broker, no Zookeeper
- schema-registry 7.7.1   Avro schema versioning
- redis 7-alpine          hot cache
- minio                   S3-compatible object store (ports 9100/9101)
- kafka-ui                Kafka topic + Schema Registry browser
- adminer                 Postgres web GUI

All ports bound to 127.0.0.1. Named Docker volumes for stateful
services. Healthchecks on postgres/clickhouse/kafka/schema-registry;
schema-registry and kafka-ui depend_on kafka being healthy.

No seed data, no auto-migrations, no topics auto-created — those
land in subsequent sub-projects (SP-2 schemas, SP-3 contracts).

Part 1 of 4 commits in SP-1. See spec at
docs/superpowers/specs/2026-05-14-sp1-docker-compose-design.md.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds with 4 file additions.

---

## Task 2: Add root pnpm scripts (Commit 2)

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Read the current root package.json**

```bash
cat package.json
```

Expected: shows the root manifest with current scripts (`dev`, `build`, `typecheck`, `lint` from Phase 0).

- [ ] **Step 2: Add the 5 infra scripts to package.json**

Use the Edit tool to update the `scripts` block. Find the existing scripts object:

```json
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint"
  },
```

Replace with:

```json
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "infra:up": "docker compose -f infra/docker-compose.yaml up -d",
    "infra:down": "docker compose -f infra/docker-compose.yaml down",
    "infra:logs": "docker compose -f infra/docker-compose.yaml logs -f",
    "infra:ps": "docker compose -f infra/docker-compose.yaml ps",
    "infra:reset": "docker compose -f infra/docker-compose.yaml down -v && pnpm infra:up"
  },
```

- [ ] **Step 3: Verify the package.json still parses as valid JSON**

```bash
python3 -c "import json; json.load(open('package.json'))" && echo "json ok"
```

Expected: `json ok`.

- [ ] **Step 4: Verify each script works**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"

pnpm infra:up
sleep 15
pnpm infra:ps
# Expected: all 8 services Up

pnpm infra:down
# Expected: all 8 stop

pnpm infra:up
sleep 15
pnpm infra:ps
# Expected: back up
```

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore: add infra:* pnpm scripts at root

Wraps docker compose commands behind discoverable pnpm scripts:
- infra:up     start the stack in detached mode
- infra:down   stop the stack (data persists)
- infra:logs   tail logs (passes args through, e.g. pnpm infra:logs kafka)
- infra:ps     show service status
- infra:reset  destroy volumes and re-up (full wipe)

Part 2 of 4 commits in SP-1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds with 1 file modified.

---

## Task 3: Add infra/verify.sh automated health-check script (Commit 3)

**Files:**
- Create: `infra/verify.sh`

- [ ] **Step 1: Create the verify script**

Write to `infra/verify.sh`:

```bash
#!/usr/bin/env bash
# Verifies all 8 services in the local Docker Compose stack are healthy.
# Exits 0 if all pass, 1 on first failure (with red [FAIL] line).

set -uo pipefail

COMPOSE_FILE="$(cd "$(dirname "$0")" && pwd)/docker-compose.yaml"
PASS=0
FAIL=0

red()   { printf "\033[0;31m%s\033[0m\n" "$1"; }
green() { printf "\033[0;32m%s\033[0m\n" "$1"; }

check() {
  local name="$1"
  local cmd="$2"
  local expect_grep="$3"
  local actual
  actual=$(eval "$cmd" 2>&1)
  if [[ -z "$expect_grep" ]] || echo "$actual" | grep -qE "$expect_grep"; then
    green "[PASS] $name"
    PASS=$((PASS + 1))
  else
    red "[FAIL] $name"
    echo "  cmd: $cmd"
    echo "  expected match: $expect_grep"
    echo "  actual: $(echo "$actual" | head -3)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Brain local stack verification ==="
echo

check "1. All 8 containers Up" \
  "docker compose -f '$COMPOSE_FILE' ps --format '{{.Name}} {{.State}}' | wc -l | tr -d ' '" \
  "^8$"

check "2. Postgres reachable + brain db exists" \
  "psql 'postgres://postgres:postgres@localhost:5432/brain' -tAc 'SELECT current_database();'" \
  "^brain$"

check "3. ClickHouse /ping" \
  "curl -s --max-time 5 http://localhost:8123/ping" \
  "^Ok\\.$"

check "4. ClickHouse SELECT 1" \
  "curl -s --max-time 5 'http://localhost:8123/?query=SELECT+1'" \
  "^1$"

check "5. Kafka responsive" \
  "docker compose -f '$COMPOSE_FILE' exec -T kafka kafka-broker-api-versions --bootstrap-server localhost:9092 2>&1 | head -1" \
  "kafka:9092"

check "6. Schema Registry reachable" \
  "curl -s --max-time 5 http://localhost:8081/subjects" \
  "^\\[\\]$|^\\[.*\\]$"

check "7. Redis PING" \
  "docker compose -f '$COMPOSE_FILE' exec -T redis redis-cli ping" \
  "^PONG$"

check "8. MinIO live" \
  "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:9100/minio/health/live" \
  "^200$"

echo
echo "=== Result: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x infra/verify.sh
ls -la infra/verify.sh
# Expected: -rwxr-xr-x ... infra/verify.sh
```

- [ ] **Step 3: Run verify against the running stack**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
# Make sure stack is up
pnpm infra:up
sleep 20  # let schema-registry come fully healthy

bash infra/verify.sh
echo "verify_exit=$?"
```

Expected: 8 green `[PASS]` lines, summary `8 passed, 0 failed`, `verify_exit=0`.

If any fail, diagnose with `pnpm infra:logs <service>` and fix before continuing.

- [ ] **Step 4: Run verify again after a reset to confirm reproducibility**

```bash
pnpm infra:reset
sleep 25  # full re-init takes longer than a normal start
bash infra/verify.sh
echo "verify_exit=$?"
```

Expected: still `8 passed, 0 failed`, `verify_exit=0`.

- [ ] **Step 5: Commit**

```bash
git add infra/verify.sh
git commit -m "$(cat <<'EOF'
feat(infra): add verify.sh — automated health checks for the stack

Bash script automating the 8 non-browser health checks from the
SP-1 spec. Run with \`bash infra/verify.sh\`. Exits 0 on all green,
1 on first failure with diagnostic detail (cmd, expected pattern,
actual output).

Browser-based checks (ClickHouse Play UI, Kafka UI, Adminer) stay
manual.

Part 3 of 4 commits in SP-1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds with 1 file added.

---

## Task 4: Update infra/README.md with prerequisites + URL cheat-sheet (Commit 4)

**Files:**
- Modify: `infra/README.md` (replace the Phase 0 stub with a full README)

- [ ] **Step 1: Read the current stub**

```bash
cat infra/README.md
```

Expected: short Phase 0 stub describing future infra contents.

- [ ] **Step 2: Replace `infra/README.md` with the full version**

Overwrite `infra/README.md` with:

```markdown
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
```

- [ ] **Step 3: Verify the file is well-formed markdown (no broken syntax)**

```bash
wc -l infra/README.md
# Expected: ~80-100 lines

head -5 infra/README.md
# Expected: starts with "# infra/"
```

- [ ] **Step 4: Commit**

```bash
git add infra/README.md
git commit -m "$(cat <<'EOF'
docs(infra): expand README with stack docs, cheat-sheet, troubleshooting

Replaces the Phase 0 placeholder stub with a full SP-1 README:
prerequisites, daily commands, URL/connection-string cheat-sheet for
all 8 services, verify.sh usage, troubleshooting for common issues
(Docker not running, port collisions, KRaft restart loops,
ClickHouse macOS permissions, disk reclamation), and an explicit
"deferred" section listing what's intentionally not in SP-1.

Part 4 of 4 commits in SP-1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds with 1 file modified.

---

## Task 5: Final verification + push + open PR

**Files:** none

- [ ] **Step 1: Bring the stack up from a clean slate one final time**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm infra:reset
sleep 30  # full reset takes longer
pnpm infra:ps
```

Expected: all 8 services `Up` (the four with healthchecks should also show `(healthy)`).

- [ ] **Step 2: Run the full verification script**

```bash
bash infra/verify.sh
echo "verify_exit=$?"
```

Expected: `8 passed, 0 failed`, `verify_exit=0`.

- [ ] **Step 3: Manual browser checks (ask the user)**

Open in browser, confirm each loads:
- http://localhost:8123/play — ClickHouse Play UI renders, can run `SELECT 1`
- http://localhost:8080 — Kafka UI shows the `brain-local` cluster (no topics)
- http://localhost:8082 — Adminer; connect with system=PostgreSQL, server=postgres, user=postgres, password=postgres, database=brain

> Pause and wait for user confirmation that all 3 browser checks pass.

- [ ] **Step 4: Verify commit history on the branch**

```bash
git log --oneline main..HEAD
```

Expected: 4 commits in this order (newest first):
```
<sha> docs(infra): expand README with stack docs, cheat-sheet, troubleshooting
<sha> feat(infra): add verify.sh — automated health checks for the stack
<sha> chore: add infra:* pnpm scripts at root
<sha> feat(infra): add local Docker Compose stack with 8 services
```

- [ ] **Step 5: Bring stack down before push (clean shutdown)**

```bash
pnpm infra:down
```

- [ ] **Step 6: Push the branch**

```bash
git push -u origin phase-1-sp1-docker-compose
```

Expected: branch pushed; GitHub returns the PR-create URL.

- [ ] **Step 7: Open the PR via the GitHub URL**

Visit `https://github.com/Pipadacapital/looqus-2/pull/new/phase-1-sp1-docker-compose` (or use `gh pr create` if installed).

**Title:** `Phase 1 SP-1: local Docker Compose stack (8 services)`

**Body:**

```markdown
First sub-project of Phase 1 (Data Plane Foundation). Stands up the full local data-plane Docker Compose stack so subsequent sub-projects (schemas, contracts, tenancy helpers) and Phase 2+ services have a runtime to develop against.

Spec: `docs/superpowers/specs/2026-05-14-sp1-docker-compose-design.md`
Plan: `docs/superpowers/plans/2026-05-14-sp1-docker-compose.md`

## What's in the stack

8 services, all bound to `127.0.0.1`, ~3GB RAM idle:

- `postgres:16` — OLTP
- `clickhouse 24.3` — OLAP
- `confluentinc/cp-kafka:7.7.1` — Kafka in KRaft mode (no Zookeeper)
- `confluentinc/cp-schema-registry:7.7.1` — Avro schemas
- `redis:7-alpine` — hot cache
- `minio:latest` — S3-compatible object store (ports 9100/9101 to avoid collision with ClickHouse 9000)
- `provectuslabs/kafka-ui:latest` — Kafka topic browser
- `adminer:latest` — Postgres web GUI

Named Docker volumes for stateful services. Healthchecks on the four services where boot order matters (postgres, clickhouse, kafka, schema-registry). Schema Registry and Kafka UI `depends_on: kafka (healthy)`.

## What's NOT in the stack (deferred)

- **LocalStack** — Phase 2/8 (when SES/EventBridge mocking is actually needed)
- **Postgres extensions** — SP-2 (when Prisma migrations need them)
- **ClickHouse clustering** — single-node locally; production handles HA in Phase 11
- **CDK / AWS infra** — Phase 11

## Four commits

1. `feat(infra): add local Docker Compose stack with 8 services` — the compose file + Kafka KRaft config + ClickHouse minimal config
2. `chore: add infra:* pnpm scripts at root` — `up`, `down`, `logs`, `ps`, `reset`
3. `feat(infra): add verify.sh — automated health checks for the stack` — 8 non-browser health checks, exits 0 on green
4. `docs(infra): expand README with stack docs, cheat-sheet, troubleshooting` — full infra/README.md

Squash-merge recommended.

## Test plan

- [ ] CI passes (TS-only — doesn't run Docker)
- [ ] Local: `pnpm infra:up` brings up all 8 services
- [ ] Local: `bash infra/verify.sh` exits 0 (`8 passed, 0 failed`)
- [ ] Local browser: ClickHouse Play UI, Kafka UI, Adminer all load
- [ ] Local: `pnpm infra:reset` reproduces the clean stack
- [ ] Fresh clone + `pnpm install && pnpm infra:up && bash infra/verify.sh` works end-to-end

## Rollback

`git revert <merge-commit>` removes the compose file + scripts. `docker volume prune` reclaims ~few-hundred-MB of disk.
```

- [ ] **Step 8: Stop and hand back to user**

Report:
- PR URL
- Four commit SHAs
- "Stack verified locally; ready for your review and squash-merge."

Do not merge automatically.

---

## Self-review notes

- **Spec coverage:** All 7 sections of the spec map to tasks: Section 1 (containers) → Task 1; Section 2 (file layout) → Tasks 1, 3, 4; Section 3 (network/ports/volumes) → Task 1; Section 4 (init behavior) → Task 1 + verified in Task 5; Section 5 (developer UX) → Task 2; Section 6 (verification) → Task 3 + 5; Section 7 (risks) → addressed via troubleshooting in Task 4. Definition-of-done items all covered by Task 5. ✓
- **Placeholder scan:** No TBDs in actionable steps. The "currently we ship hard-coded ports" note in the README troubleshooting is a real fact, not a deferred plan item. ✓
- **Type/identifier consistency:** `brain-postgres-data` (volume) consistent across compose file and README; `brain-local` (network) consistent; service names (`postgres`, `kafka`, `schema-registry`, etc.) consistent. Container names (`brain-postgres`, etc.) consistent. ✓
- **Ambiguity check:** Step 5 of Task 1 says "sleep 15" — qualitative. If the engineer's machine is slow or under load, 15s may not be enough. Step 4 of Task 5 also says "sleep 30". These are reasonable defaults; the verify.sh will fail clearly if a service isn't ready. ✓
