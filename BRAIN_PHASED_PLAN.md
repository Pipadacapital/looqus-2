# Brain — Phased Implementation Plan

> **Source spec:** `Technical Document.pdf` (Brain Technical Documentation v2.0, 2026-05-13).
> **Mission:** Replace the slow Next.js/TypeScript metric calculations with a real backend (Node + Python microservices on AWS, Kafka-driven, ClickHouse OLAP, Claude AI), by rearranging the existing Looqus repo into the Brain monorepo layout — **without disrupting the live Looqus app at any point**.
>
> **Audience:** Cursor (or any AI coding agent). Execute phases sequentially. Each phase has a non-disruption guarantee and exit criteria. Do not skip ahead.

---

## Core Operating Rules (read before every phase)

1. **The current Next.js app at `app/` must keep working through Phase 9.** Every PR must leave `npm run dev` green and every analytics page functional. If a refactor would break a page, ship behind a feature flag.
2. **Strangler-fig cutover.** When migrating a metric from TS → Python, keep the TS implementation alive behind a per-page env flag (`USE_BRAIN_<METRIC>=true|false`). Default false. Flip per-workspace once parity is verified.
3. **Parity before deletion.** A TS metric calc is only deleted after: (a) the Python equivalent passes a parity test on production data for that workspace, (b) the page has run on Brain for 7 days without complaints, (c) cached results match within 0.01%.
4. **Multi-tenant from line 1.** Every new table, query, gRPC handler, Kafka payload carries `workspace_id`. Postgres uses RLS; ClickHouse uses `workspace_id` as first column in primary key.
5. **No new code in `module/ai/`, `lib/ai-calc/`, `lib/insights/`.** These stay frozen until Phase 9 deletion.
6. **Never query `workspace_daily_metrics`** (empty / unused).
7. **Source data is immutable; derived data is rebuildable.** Raw events land in Kafka + S3 with infinite retention; ClickHouse aggregates can always be rebuilt by replay.
8. **TS services never do heavy math; Python services never serve user-facing latency-critical I/O paths.** Hard boundary.
9. **No raw DB rows to LLMs.** AI consumes pre-aggregated metric summaries only. 2k token context budget per insight.
10. **Always compare to prior period and run statistical analysis (z-score/IQR) before prompting the LLM.**
11. **Workspace membership validated on every API route. UTC boundaries on every date range.**
12. **No LangChain, no LlamaIndex, no Pinecone, no Spark/Airflow, no GraphQL, no BullMQ.** See Decision Log in spec.

---

## Repo Target Structure (end state)

```
brain/
├── apps/
│   ├── frontend/                  # current Next.js app, relocated
│   ├── api-gateway/               # Node + Fastify + tRPC + grpc-js (BFF)
│   ├── core-service/              # Node + Fastify + Prisma (OLTP)
│   ├── ingestion-service/         # Python + FastAPI + asyncpg (ETL)
│   ├── analytics-service/         # Python + FastAPI + clickhouse-driver (metric engine)
│   ├── intelligence-service/      # Python + FastAPI + Anthropic SDK (AI/ML)
│   └── notifications-service/     # Node + Fastify (alerts, digests, exports)
├── packages/                      # Shared TypeScript libraries
│   ├── ui/                        # shadcn-derived components
│   ├── lib-metrics/               # Type-safe metric registry (TS mirror)
│   ├── lib-regional/              # Region adapter interface + currency utils
│   ├── lib-grpc-clients/          # Generated gRPC TS clients
│   ├── lib-kafka/                 # Kafka producer/consumer wrappers
│   ├── lib-auth/                  # JWT, session utils
│   ├── eslint-config/
│   └── tsconfig/
├── pylibs/                        # Shared Python libraries
│   ├── brain_metrics/             # Metric registry mirror
│   ├── brain_regional/            # Region adapter mirror
│   ├── brain_kafka/               # Kafka wrapper
│   ├── brain_clickhouse/          # ClickHouse client + query helpers (workspace_id enforcement)
│   ├── brain_db/                  # Postgres connection, multi-tenant helpers
│   └── brain_grpc/                # Generated gRPC Python clients
├── protos/                        # Protobuf definitions (single source of truth)
│   ├── core/
│   ├── analytics/
│   ├── intelligence/
│   ├── notifications/
│   └── events/                    # Kafka event schemas (Avro/JSON)
├── infra/                         # AWS CDK (TypeScript)
│   ├── stacks/
│   │   ├── network.ts
│   │   ├── compute.ts             # EKS, node groups
│   │   ├── data.ts                # RDS/Supabase peering, ClickHouse, ElastiCache
│   │   ├── kafka.ts               # MSK cluster, topics, IAM
│   │   ├── storage.ts             # S3, CloudFront
│   │   ├── observability.ts       # CloudWatch, alarms
│   │   └── security.ts            # IAM roles, Secrets Manager
│   └── bin/
├── docs/
│   ├── BRAIN_REQUIREMENTS.md
│   ├── BRAIN_TECHNICAL_DOCUMENTATION.md
│   └── TECH/01..09_*.md
├── tools/
│   ├── codegen-proto.sh
│   └── seed-demo.py
├── .github/workflows/
├── turbo.json                     # Turborepo for TS workspaces
├── pnpm-workspace.yaml
├── pyproject.toml                 # uv workspace for Python apps
└── README.md
```

The current Looqus `app/`, `lib/`, `module/`, `prisma/`, `public/`, `components/` directories all eventually land inside `apps/frontend/` (or get deleted). The migration is gradual.

---

## Phase 0 — Repo Rearrangement (Non-Disruptive)

**Mission:** Reshape the repo into the Brain monorepo layout while the Next.js app keeps running unchanged.

> **Phase 0 deviation (executed 2026-05-14):** Scope reduced to frontend move + monorepo tooling only. Service shells, all `packages/*`, all `pylibs/*`, Docker Compose, Python tooling, protobuf scaffolding, full multi-language CI, and `infra/` CDK are deferred to their owning phases (e.g. ingestion-service scaffolds at Phase 2 start). Rationale: scaffolding 6 services 6+ weeks before implementation produces dead code that rots. See `docs/superpowers/specs/2026-05-14-phase-0-monorepo-design.md` for the full design and `docs/superpowers/plans/2026-05-14-phase-0-monorepo.md` for the executed plan.

### Deliverables

- [x] Create top-level dirs: `apps/`, `packages/`, `pylibs/`, `protos/`, `infra/`, `tools/`, `docs/`.
- [x] Move current Next.js app into `apps/frontend/`:
  - Move `app/`, `components/`, `lib/`, `module/`, `prisma/`, `public/`, `middleware.ts`, `next.config.ts`, `tailwind.config.*`, `postcss.config.*`, `tsconfig.json`, `package.json`, `package-lock.json`, `.env*` → `apps/frontend/`.
  - Keep `CLAUDE.md`, `AI_INSIGHTS_PLAN.md`, `BRAIN_PHASED_PLAN.md`, `.git/`, `.gitignore`, `.claude/` at repo root.
  - Verify: `cd apps/frontend && npm run dev` works identically to before.
- [x] Add `pnpm-workspace.yaml`, `turbo.json` at root. Convert `apps/frontend/package.json` to use the workspace.
- [ ] Add `pyproject.toml` (uv workspace) at root with placeholder for Python apps. *(Deferred — added in Phase 1.)*
- [x] Add `tsconfig.base.json` at root; `apps/frontend/tsconfig.json` extends it.
- [ ] Scaffold empty service shells (each with `package.json` or `pyproject.toml`, a `src/`, a `Dockerfile`, a `README.md` describing the service responsibility): *(Deferred per deviation note — each scaffolds at the start of its owning phase.)*
  - `apps/api-gateway/` (Node 20, Fastify, tRPC, grpc-js)
  - `apps/core-service/` (Node 20, Fastify, Prisma, grpc-js)
  - `apps/ingestion-service/` (Python 3.12, FastAPI, asyncpg, grpcio)
  - `apps/analytics-service/` (Python 3.12, FastAPI, clickhouse-driver, grpcio)
  - `apps/intelligence-service/` (Python 3.12, FastAPI, Anthropic SDK, grpcio)
  - `apps/notifications-service/` (Node 20, Fastify, grpc-js)
- [ ] Scaffold empty shared packages: `packages/ui`, `packages/lib-metrics`, `packages/lib-regional`, `packages/lib-grpc-clients`, `packages/lib-kafka`, `packages/lib-auth`, `packages/eslint-config`, `packages/tsconfig`. *(Deferred — added on demand starting Phase 1.)*
- [ ] Scaffold empty pylibs: `pylibs/brain_metrics`, `pylibs/brain_regional`, `pylibs/brain_kafka`, `pylibs/brain_clickhouse`, `pylibs/brain_db`, `pylibs/brain_grpc`. *(Deferred — added in Phase 1.)*
- [ ] Move `Technical Document.pdf` content into `docs/BRAIN_TECHNICAL_DOCUMENTATION.md` (markdown source) and `docs/BRAIN_REQUIREMENTS.md` (product spec — leave a stub if not available). *(Deferred.)*
- [ ] Set up monorepo CI in `.github/workflows/ci.yml`: *(Partial — only Job 1 (TS) added; Jobs 2 and 3 deferred per deviation note.)*
  - [x] Job 1: `pnpm install`, `pnpm turbo run typecheck build` (TS apps + packages). *(`lint` deferred — no shared eslint config across workspaces yet.)*
  - [ ] Job 2: `uv sync`, `uv run ruff check`, `uv run mypy`, `uv run pytest` (Python apps + pylibs). *(Deferred until pylibs exist.)*
  - [ ] Job 3: `buf lint` on `protos/` (placeholder until Phase 1). *(Deferred until protos exist.)*
- [ ] Add `tools/codegen-proto.sh` (placeholder script that runs `buf generate`). *(Deferred to Phase 1.)*
- [ ] Add root `Makefile` / `package.json` scripts: `make dev` (Docker Compose up + all services), `make typecheck`, `make test`. *(Partial — root `package.json` has `dev`/`build`/`typecheck`/`lint` scripts via Turborepo; Makefile and Docker Compose deferred to Phase 1.)*

### Non-Disruption Guarantee

- `cd apps/frontend && npm run dev` produces the exact same app as today.
- All existing Prisma migrations remain in `apps/frontend/prisma/`.
- All existing env vars work unchanged (point to current Supabase + integrations).
- All existing app/api routes work unchanged.

### Exit Criteria

- Fresh clone + `pnpm install && pnpm turbo run build` succeeds.
- Frontend runs at `localhost:3000` from `apps/frontend/` with all current pages functional.
- CI is green on a no-op PR.
- All 6 service directories exist with a "hello world" gRPC server that responds to a health check.

### Cursor Hints

- This is a pure move + scaffold phase. **Do not refactor TS code, do not change Prisma schema, do not touch `lib/` internals.** Only relocate files.
- After moving `apps/frontend/`, run `npm run build` and fix only import-path issues introduced by the move.
- Use `git mv` (not delete+create) so history is preserved.

---

## Phase 1 — Data Plane Foundation

**Mission:** Stand up the OLTP/OLAP/event-streaming substrate locally and define every data contract. No metric calculations yet — only the rails.

### Deliverables

#### 1.1 Local Docker Compose (`infra/docker-compose.yaml`)

- Postgres 16 (single instance, mimics Supabase)
- ClickHouse Cloud-compatible image (e.g. `clickhouse/clickhouse-server:24.3`)
- Kafka single-broker (`confluentinc/cp-kafka`) + Zookeeper
- Redis 7
- MinIO (S3 stand-in)
- LocalStack (SES, EventBridge mocks)

#### 1.2 Postgres Schemas (`apps/core-service/prisma/schema.prisma`)

Start by **mirroring** the current Looqus Prisma schema into `apps/core-service/prisma/schema.prisma`. Keep field names identical. Add these new tables that don't exist in Looqus today:

- `home_region` column on `Workspace` (default `ap-south-1`).
- `goals` table (workspace_id, metric, target, period, owner_user_id, created_at, updated_at).
- `alert_rules` table (workspace_id, metric, condition, threshold, channels, enabled).
- `marketing_actions_log` (workspace_id, action_type, payload, performed_by, performed_at).
- `in_app_notifications`, `alert_events`, `export_jobs`.
- `ai_insights` (workspace_id, page, date_from, date_to, filters_hash, model, prompt_tokens, completion_tokens, body, citations, generated_at, expires_at).
- `ai_chat_threads`, `ai_chat_messages` (workspace_id, thread_id, role, content, tool_calls).
- Enable RLS on every workspace-scoped table with policy `USING (workspace_id = current_setting('app.workspace_id')::uuid)`.

#### 1.3 ClickHouse Schemas (`apps/analytics-service/sql/schema/`)

Create migration files (numbered `001_*.sql`, `002_*.sql`, …):

- `raw_orders` (workspace_id, source, raw_payload JSON, ingested_at)
- `raw_shipments`, `raw_ad_insights`, `raw_refunds`, `raw_customers`
- `canonical_orders` (workspace_id, order_id, customer_id, total, currency, tags, status, placed_at, …) — `ORDER BY (workspace_id, placed_at, order_id)`
- `canonical_line_items` (workspace_id, order_id, sku, qty, unit_price, cogs, …)
- `canonical_shipments` (workspace_id, shipment_id, courier, status, charges JSON, picked_up_at, delivered_at, rto_at, …)
- `canonical_ads` (workspace_id, platform, campaign_id, ad_set_id, ad_id, date, spend, impressions, clicks, conversions, revenue_attributed)
- `daily_metrics` (workspace_id, date, revenue, orders, customers, new_customers, returning_customers, ad_spend, …)
- `customer_states` (workspace_id, customer_id, lifecycle_stage, first_order_at, last_order_at, total_orders, ltv)
- `cohort_aggregates` (workspace_id, cohort_month, period_index, customers_remaining, revenue, …)
- `first_product_attribution` (workspace_id, customer_id, first_product_sku, first_product_category, first_order_at, second_order_at, repeat_at_90d, repeat_at_180d)
- `pincode_reliability` (workspace_id, pincode, total_shipments, delivered, rto, prepaid_share, …)

**Every table has `workspace_id` as the first column of `ORDER BY`.** Engine: `ReplicatedMergeTree` in cluster mode, `MergeTree` locally.

#### 1.4 Protobuf Contracts (`protos/`)

Define every gRPC service contract upfront. Each `.proto` file goes into the matching subdir:

- `protos/core/workspaces.proto` — `WorkspaceService` (GetWorkspace, ListMembers, GetIntegrations, UpdateSettings)
- `protos/analytics/metrics.proto` — `MetricsService` (GetDailyMetrics, GetPnL, GetWaterfall, GetAcquisition, GetCohorts, GetLTV, GetTimings, GetDistributions, GetCustomerLifecycle, GetFirstProductCascade, GetMetaAdsMetrics, GetGoogleAdsMetrics, GetProducts, GetInventory, GetLogistics, GetRTO, GetPincodeIntelligence, GetCODPrepaid, GetCalendarReport, GetEmailSMSReport, GetStoreOrders, GetStoreProducts, GetStoreCustomers)
- `protos/intelligence/insights.proto` — `InsightsService` (GeneratePageInsight streaming, GenerateGlobalInsight streaming, Chat streaming, GetForecasts, GetAnomalies, GetBudgetRecommendations)
- `protos/notifications/alerts.proto` — `NotificationsService` (CreateAlertRule, SendDigest, CreateExport)
- `protos/events/*.avsc` — Avro schemas for every Kafka topic (one file per topic):
  - `integrations.orders.v1.avsc`
  - `integrations.shipments.v1.avsc`
  - `integrations.ads.v1.avsc`
  - `integrations.refunds.v1.avsc`
  - `integrations.customers.v1.avsc`
  - `operations.workspace.changed.v1.avsc`
  - `operations.settings.changed.v1.avsc`
  - `analytics.metrics.daily_materialized.v1.avsc`
  - `analytics.customer_state.changed.v1.avsc`
  - `intelligence.anomaly.detected.v1.avsc`
  - `intelligence.insight.generated.v1.avsc`
  - `notifications.alert.fired.v1.avsc`

**Every message has `workspace_id` as a required field.**

Run `buf generate` to produce TS clients (`packages/lib-grpc-clients/`) and Python clients (`pylibs/brain_grpc/`).

#### 1.5 Kafka Topics

In `infra/stacks/kafka.ts`, declare every topic. Locally, create them via a one-shot script `tools/setup-kafka-local.sh`:

- All `integrations.*.v1` topics: 12 partitions, replication factor 3 (1 locally), tiered to S3.
- All `operations.*.v1`, `analytics.*.v1`, `intelligence.*.v1`, `notifications.*.v1`: 6 partitions, 30-day retention.
- Partition key: `workspace_id` for every topic.

#### 1.6 Workspace-Tenancy Helpers

- `pylibs/brain_clickhouse/query.py`: `WorkspaceScopedQuery` class that **refuses to execute** any query lacking `WHERE workspace_id = %s`. Compile-time check via mypy plugin or runtime assertion.
- `pylibs/brain_db/connection.py`: `with_workspace(workspace_id)` context manager that sets `app.workspace_id` session var (for RLS).
- `packages/lib-grpc-clients/index.ts`: middleware that injects `workspace_id` into every outbound gRPC call's metadata, and rejects inbound calls whose metadata `workspace_id` doesn't match the request body.

### Non-Disruption Guarantee

- Nothing in `apps/frontend/` changes.
- No new env vars required for the Next.js app.
- New infra is only local Docker Compose; production untouched.

### Exit Criteria

- `make dev` brings up Postgres + ClickHouse + Kafka + Redis + MinIO locally.
- `pnpm turbo run db:migrate` applies core-service Postgres schema.
- `python -m apps.analytics-service.sql.migrate` applies ClickHouse schema.
- `buf generate` produces both TS and Python gRPC clients.
- All 6 services start (still empty handlers, but bind to ports + register with health check).
- A no-op publish/consume round-trip works on `integrations.orders.v1` via a test script.
- A test query against ClickHouse without `workspace_id` raises an exception.

### Cursor Hints

- Mirror Looqus Prisma schema field-for-field in `apps/core-service/prisma/schema.prisma` before adding anything new. Don't redesign.
- For ClickHouse, denormalize aggressively. Join is not free here.
- Avro schemas are checked into `protos/events/`. Don't generate them at runtime.

---

## Phase 2 — Ingestion Service (Connector Parity)

**Mission:** Stand up `ingestion-service` and bring every external data source into Kafka. Backfill mode and live mode share one code path.

### Deliverables

#### 2.1 Service Skeleton (`apps/ingestion-service/`)

```
apps/ingestion-service/
├── src/
│   ├── main.py                       # FastAPI app + grpc server
│   ├── connectors/
│   │   ├── base.py                   # Connector ABC: fetch_window(workspace, mode, from, to) -> AsyncIterator[Event]
│   │   ├── shopify.py
│   │   ├── meta_ads.py
│   │   ├── google_ads.py
│   │   ├── shiprocket.py
│   │   ├── klaviyo.py
│   │   ├── woocommerce.py
│   │   └── unicommerce.py
│   ├── scheduler/
│   │   ├── eventbridge_consumer.py   # consumes scheduled tick events
│   │   └── job_runner.py             # idempotent per (workspace, integration, window)
│   ├── canonicalize/
│   │   ├── orders.py                 # raw → canonical_orders.v1
│   │   ├── shipments.py
│   │   ├── ads.py
│   │   ├── refunds.py
│   │   └── customers.py
│   ├── oauth/
│   │   ├── refresh.py                # per-integration token refresh
│   │   └── store.py                  # reads/writes via core-service gRPC
│   └── publish/
│       └── kafka.py                  # publishes to integrations.*.v1
├── tests/
└── pyproject.toml
```

#### 2.2 Connector Interface

```python
class Connector(ABC):
    integration_name: str

    async def fetch_window(
        self,
        workspace_id: UUID,
        mode: Literal["backfill", "live"],
        window_from: datetime,
        window_to: datetime,
    ) -> AsyncIterator[RawEvent]: ...

    async def to_canonical(self, raw: RawEvent) -> CanonicalEvent: ...
```

Backfill = bounded window (`from`, `to`). Live = unbounded (`from`, `now`). **Same function.**

#### 2.3 Connector Migration from Looqus

For each Looqus connector in `apps/frontend/lib/integrations/` and `apps/frontend/lib/shopify/`:

1. Read the current TS implementation; understand fetch/page/throttle/retry logic.
2. Reimplement in Python with `httpx` (async) + `tenacity` (retries).
3. Persist raw payloads to ClickHouse `raw_*` tables + S3 backup.
4. Canonicalize and publish to Kafka `integrations.*.v1`.
5. Write parity test: run TS connector and Python connector against the same workspace for a known window; assert canonical output matches.
6. Until parity passes, keep Looqus's `lib/integrations/<x>/sync` route running on its schedule. Brain's ingestion runs in shadow mode (writes to Kafka but Looqus ignores).

Connectors to migrate, in order:
- **Shopify** (highest value, most complex)
- **Meta Ads**
- **Google Ads**
- **Shiprocket**
- **WooCommerce**
- **Unicommerce**
- **Klaviyo**

#### 2.4 Idempotency & Resume

- Job state in Postgres: `ingestion_jobs(workspace_id, integration, window_from, window_to, status, attempt, cursor)`.
- Connectors UPSERT into `raw_*` with `(workspace_id, source_event_id)` as natural key.
- Restart from `cursor` on retry.

#### 2.5 OAuth Token Management

- Tokens stored in Postgres encrypted at rest (AES-GCM via AWS KMS in prod, local key for dev).
- core-service exposes `GetIntegrationCredentials(workspace_id, integration)` over gRPC; ingestion-service never reads tokens from Postgres directly.
- Refresh runs on a background task; refresh failures publish `operations.integration.failed.v1`.

### Non-Disruption Guarantee

- Looqus's existing sync routes (`apps/frontend/app/api/cron/*`, `apps/frontend/app/api/integrations/**/sync`) keep running.
- Brain's ingestion runs in **shadow mode**: writes to Kafka + ClickHouse but is not yet read by anything user-facing.
- No data overwrites: raw events use UPSERT keyed by `(workspace_id, source_event_id)`.

### Exit Criteria

- Every connector has been ported and passes a parity test on at least one workspace's last 30 days.
- `integrations.*.v1` topics receive events continuously when ingestion-service is running.
- ClickHouse `raw_*` tables fill in real-time.
- A `kafkacat`/`kcat` tail on any topic shows live events.
- Replay test: deleting a `canonical_*` table and re-running consumers from Kafka offset 0 reproduces it byte-for-byte.

### Cursor Hints

- **Never invent connector logic.** Read the Looqus TS connector first. Match its behavior exactly.
- Rate limits: Shopify 4 req/s/store, Meta 200 calls/hour/app, Google Ads QPS limits, Shiprocket no documented limit (be polite, 5 req/s).
- Use Shopify Bulk Operations API for backfills > 30 days; webhook for live.
- Klaviyo connector reads events but **never sends emails** — that's the notifications-service.

---

## Phase 3 — Core Service (OLTP)

**Mission:** Stand up the system-of-record service. Workspaces, users, members, integrations config, cost settings, goals, alert rules.

### Deliverables

#### 3.1 Service Skeleton (`apps/core-service/`)

```
apps/core-service/
├── src/
│   ├── server.ts                # Fastify + grpc-js
│   ├── grpc/
│   │   ├── workspaces.ts
│   │   ├── members.ts
│   │   ├── integrations.ts
│   │   ├── settings.ts
│   │   ├── goals.ts
│   │   └── alert-rules.ts
│   ├── publish/
│   │   └── kafka.ts             # operations.*.v1 publisher
│   ├── auth/
│   │   └── supabase.ts          # validates Supabase JWT
│   └── db/
│       └── prisma.ts
├── prisma/
│   └── schema.prisma            # ← from Phase 1
└── package.json
```

#### 3.2 gRPC Handlers

Implement every RPC in `protos/core/*.proto`. Each handler:
1. Validates `metadata.workspace_id` against `request.workspace_id`.
2. Sets `app.workspace_id` session var (for RLS).
3. Calls Prisma.
4. Publishes `operations.*.v1` event on mutation.
5. Returns the proto response.

#### 3.3 Kafka Publishing

Every mutation publishes:
- `operations.workspace.changed.v1` on workspace update.
- `operations.settings.changed.v1` on costs/COGS/campaign-classification/goals/alert-rules update.
- `operations.integration.connected.v1`, `operations.integration.disconnected.v1`.
- `operations.marketing.action.logged.v1`.

#### 3.4 Redis Cache Layer

- 60s TTL on workspace metadata, member lists, integration status.
- Cache key: `core:ws:{workspace_id}:{shape}`.
- Invalidation on mutation: publish to Kafka + delete cache key.

#### 3.5 Data Migration

- One-time script: `tools/migrate-looqus-to-core.ts` — reads Looqus Supabase Postgres directly, writes to core-service Postgres via Prisma. Idempotent. Runs in dry-run mode by default; `--commit` to apply.
- Initially both DBs point to the same Supabase instance (core-service Prisma schema is a subset/extension of Looqus's). Migration is a logical re-pointing, not a data copy.

### Non-Disruption Guarantee

- Looqus's frontend continues reading/writing Postgres via its own Prisma. core-service runs in parallel pointing at the **same** Supabase instance.
- core-service is in shadow mode: producers (Looqus's API routes) and core-service Prisma both write to Postgres, but only Looqus's writes are user-triggered.
- Reads through core-service are exercised by api-gateway's test harness only.

### Exit Criteria

- All `protos/core/*.proto` RPCs implemented and tested.
- core-service running locally responds to gRPC calls.
- Mutation through core-service publishes the corresponding `operations.*.v1` event.
- RLS verified: a query without `app.workspace_id` set fails.

### Cursor Hints

- Don't extend the schema beyond what's in `apps/core-service/prisma/schema.prisma` from Phase 1. Add fields via migration in this phase only if a gRPC handler needs them.
- Reuse Looqus's existing Prisma model names and field names exactly. Cross-service queries during cutover depend on alignment.

---

## Phase 4 — Analytics Service Foundation

**Mission:** Stand up `analytics-service` Python skeleton, consume `integrations.*.v1`, materialize `daily_metrics`, `customer_states`, `cohort_aggregates`. No page-specific metrics yet — only the foundations every page reuses.

### Deliverables

#### 4.1 Service Skeleton (`apps/analytics-service/`)

```
apps/analytics-service/
├── src/
│   ├── main.py                          # FastAPI (health) + grpc server
│   ├── grpc/
│   │   ├── metrics_service.py           # implements protos/analytics/metrics.proto
│   │   └── workspace_metrics_service.py
│   ├── consumers/
│   │   ├── orders_consumer.py           # integrations.orders.v1 → ClickHouse canonical_orders
│   │   ├── shipments_consumer.py
│   │   ├── ads_consumer.py
│   │   ├── refunds_consumer.py
│   │   ├── customers_consumer.py
│   │   └── settings_consumer.py         # operations.settings.changed → invalidate hot cache
│   ├── materializers/
│   │   ├── daily_metrics.py             # runs hourly + on watermark
│   │   ├── customer_states.py
│   │   ├── cohort_aggregates.py
│   │   ├── first_product_attribution.py
│   │   └── pincode_reliability.py
│   ├── queries/
│   │   ├── daily_metrics.py             # query helpers using brain_clickhouse
│   │   └── …                            # one file per metric (filled in Phase 5)
│   ├── cache/
│   │   └── redis.py                     # 60s TTL on hot metric reads
│   └── publish/
│       └── kafka.py                     # analytics.*.v1 publisher
├── sql/
│   ├── schema/                          # ← from Phase 1
│   └── materialized_views/
│       ├── daily_metrics_mv.sql
│       ├── customer_states_mv.sql
│       └── cohort_aggregates_mv.sql
└── pyproject.toml
```

#### 4.2 ClickHouse Materialized Views

For each downstream aggregate, write a `MATERIALIZED VIEW` that updates incrementally as raw events arrive. Example for `daily_metrics_mv`:

```sql
CREATE MATERIALIZED VIEW daily_metrics_mv
ENGINE = SummingMergeTree
ORDER BY (workspace_id, date)
POPULATE AS
SELECT
  workspace_id,
  toDate(placed_at) AS date,
  count() AS orders,
  sum(total) AS revenue,
  uniqExact(customer_id) AS customers,
  …
FROM canonical_orders
GROUP BY workspace_id, date;
```

Materialized views cover the high-frequency aggregates. Scheduled jobs (Phase 5+) cover the heavier ones.

#### 4.3 Consumer Pattern

Each consumer:
1. Subscribes to a Kafka topic with `consumer_group = "analytics-service-<topic>"`.
2. Validates the event's `workspace_id` and Avro schema.
3. UPSERTs into ClickHouse `canonical_*` (using `ReplacingMergeTree` keyed by `(workspace_id, source_id)`).
4. Commits offset only after successful insert.
5. On failure, retries with backoff; after N retries, publishes to a DLQ topic.

#### 4.4 Watermark Strategy

- Each workspace has a `daily_metrics_watermark` row in Postgres: the most recent date for which `daily_metrics` is considered "ready."
- Materializer advances the watermark only when (a) no unprocessed events in Kafka older than the date and (b) all dependent canonical tables are caught up.
- analytics-service publishes `analytics.metrics.daily_materialized.v1{workspace_id, date}` on watermark advance.

#### 4.5 gRPC Health Endpoint

Stub every RPC in `protos/analytics/metrics.proto` with `UNIMPLEMENTED`. Phase 5 fills them in one by one.

### Non-Disruption Guarantee

- Looqus continues to serve every analytics page from TS code in `apps/frontend/lib/metrics/`. analytics-service is in shadow mode.
- No frontend code changes.

### Exit Criteria

- All 5 consumers running, lagging < 60s on a backfilled workspace.
- `daily_metrics` table in ClickHouse populated for at least one workspace, matching Looqus's `ShopifyDailyAggregate` row-by-row for the same dates (parity test).
- `cohort_aggregates`, `customer_states`, `first_product_attribution`, `pincode_reliability` materialized for the same workspace.
- `analytics.metrics.daily_materialized.v1` events published.

### Cursor Hints

- Materialized views must be **deterministic**. No `now()`, no `rand()`. Date logic in UTC.
- Reuse Looqus's date-bucketing logic from `apps/frontend/lib/pnl/buckets.ts` for week/month/quarter alignment in Python.
- For COGS resolution, port `apps/frontend/lib/cogs/resolve.ts` to `apps/analytics-service/src/queries/cogs.py` — same algorithm, but reads from ClickHouse, not Prisma.

---

## Phase 5 — Metric Migration (The Big Cutover)

**Mission:** Port every Looqus TS metric calculation to Python in `analytics-service`. Migrate page-by-page, behind a per-page flag, with parity verification at every step.

### Deliverables

#### 5.1 Migration Order (priority by complexity × impact)

Sequence:
1. `/pnl` (P&L)
2. `/waterfall` (RTO-aware contribution margin waterfall)
3. `/acquisition` (MER + aMER + acquisition vs non-acquisition)
4. `/cohorts`
5. `/lifetime-value`
6. `/first-product-cascade`
7. `/customer-lifecycle`
8. `/timings`
9. `/distributions`
10. `/products`
11. `/inventory`
12. `/meta-ads` (metrics + creative)
13. `/google-ads`
14. `/logistics`
15. `/rto-analytics`
16. `/pincode-intelligence`
17. `/cod-prepaid`
18. `/calendar`
19. `/email-sms`
20. `/store/orders|products|customers`

#### 5.2 Per-Page Migration Recipe

For each page (using `/pnl` as the worked example, repeat for every page above):

1. **Read the existing TS implementation.**
   - Page UI: `apps/frontend/app/(protected)/w/[slug]/pnl/page.tsx`
   - API route: `apps/frontend/app/api/workspaces/[slug]/pnl/route.ts`
   - Calc lib: `apps/frontend/lib/pnl/`
   - Helpers used: `apps/frontend/lib/effective-daily.ts`, `apps/frontend/lib/cogs/*`, `apps/frontend/lib/order-filters.ts`, `apps/frontend/lib/workspace-costs.ts`
2. **Define the proto.** Confirm `protos/analytics/metrics.proto` has `GetPnL(GetPnLRequest) returns (PnLResponse)`. Add/refine if needed. Regenerate clients.
3. **Implement the Python handler.**
   - `apps/analytics-service/src/queries/pnl.py` — pure ClickHouse + math functions.
   - `apps/analytics-service/src/grpc/metrics_service.py::GetPnL` — composes queries, applies filters, returns proto response.
   - Reuse existing aggregates (`daily_metrics`, `canonical_orders`, etc.). Do not query raw tables if an aggregate exists.
4. **Write parity tests.**
   - `apps/analytics-service/tests/parity/pnl_test.py` — for a fixture workspace + date range, fetches Looqus's `/api/workspaces/[slug]/pnl` response AND analytics-service's response. Assert deep equality within 0.01% on every numeric field.
   - Fixture workspaces: at least 3 — one small (Sugandh Lok scale), one medium, one large.
5. **Wire api-gateway proxy** (api-gateway is not yet built; for this phase, wire it through a temporary `apps/frontend/app/api/_brain/pnl/route.ts` that proxies the request to analytics-service over gRPC).
6. **Add per-page feature flag.**
   - In `apps/frontend/app/(protected)/w/[slug]/pnl/page.tsx`, check `process.env.BRAIN_PNL_ENABLED === 'true'` (or workspace-scoped setting). If on, fetch from `/api/_brain/pnl`; else fall back to `/api/workspaces/[slug]/pnl`.
7. **Verify in staging.**
   - Run on at least one production workspace's data with flag on. Visually inspect the page.
8. **Flip the flag.**
   - Per-workspace rollout: enable for 1 workspace, then 5, then all.
9. **Mark TS impl deprecated.**
   - Add `@deprecated — replaced by analytics-service. Delete after Phase 9 cutover.` to the TS file. Don't delete yet.

#### 5.3 Shared Python Calc Library

These Python modules in `apps/analytics-service/src/queries/` (or `pylibs/brain_metrics/` if cross-service) are referenced by multiple pages — implement them first:

- `cogs.py` — COGS resolution (port `lib/cogs/`)
- `order_filters.py` — Workspace order-tag filtering (port `lib/order-filters.ts`)
- `workspace_costs.py` — Fixed cost daily allocation (port `lib/workspace-costs.ts`)
- `shiprocket_charges.py` — Charge breakdown (port `lib/shiprocket-charges.ts`)
- `customer_first_order.py` — First-time buyer identification (port `lib/metrics/customer-first-order.ts`)
- `ads_classification.py` — Ad spend by campaign intent (port `lib/metrics/ads-spend.ts`)
- `date_buckets.py` — Day/week/month/quarter time bucketing (port `lib/pnl/buckets.ts`)
- `effective_daily.py` — Daily aggregates with analytics-cache → order fallback (port `lib/effective-daily.ts`)

#### 5.4 Caching

- 60s Redis cache on hot reads (single workspace, single date range).
- Cache key: `analytics:<rpc>:<workspace_id>:<hash(request)>`.
- Invalidate on: `operations.settings.changed.v1`, `analytics.metrics.daily_materialized.v1`.

#### 5.5 Drillability

Every aggregate response includes a `drilldown_url` field pointing to the underlying rows in ClickHouse. Operators must be able to audit every number.

### Non-Disruption Guarantee

- Each page has a flag. Flag off = Looqus serves the page exactly as today.
- TS metric code is never deleted in this phase. Only marked deprecated.
- Parity tests gate every flag flip.

### Exit Criteria

- All 20 pages migrated and running on Brain for at least one production workspace.
- Parity tests green for every metric on at least 3 workspace fixtures.
- P99 latency on `analytics-service` < 500ms per gRPC call (ClickHouse query budget).
- Hot Redis cache hit rate > 95%.

### Cursor Hints

- **Read the TS code carefully before writing Python.** Many calcs have subtle workspace-tag filtering, COGS overrides, attribution rules that aren't obvious from the math alone.
- For each page, the existing API route response shape is the contract. The new proto response must serialize to JSON that matches it exactly (field names, types, nesting). The frontend should not need to change rendering logic.
- Some Looqus calcs use multiple `lib/` modules together (e.g., `/waterfall` uses `lib/pnl/`, `lib/cogs/`, `lib/shiprocket-charges.ts`, `lib/workspace-costs.ts`, `lib/order-filters.ts`). Map every dependency.
- Don't optimize prematurely. Get parity first; tune ClickHouse later.

---

## Phase 6 — API Gateway & Frontend Cutover

**Mission:** Promote `api-gateway` to the single edge for the frontend. Replace `/api/_brain/*` proxies with a clean tRPC surface.

### Deliverables

#### 6.1 api-gateway Service (`apps/api-gateway/`)

```
apps/api-gateway/
├── src/
│   ├── server.ts                # Fastify + tRPC + grpc-js
│   ├── trpc/
│   │   ├── index.ts             # tRPC root router
│   │   ├── routers/
│   │   │   ├── workspace.ts     # core-service fan-out
│   │   │   ├── analytics.ts     # analytics-service fan-out (1 router per page)
│   │   │   ├── intelligence.ts  # intelligence-service fan-out
│   │   │   └── notifications.ts # notifications-service fan-out
│   ├── auth/
│   │   ├── supabase.ts          # validates Supabase JWT, extracts active_workspace_id
│   │   └── workspace-context.ts # propagates to downstream gRPC via metadata
│   ├── rate-limit/
│   │   └── redis.ts             # per-user + per-workspace sliding window
│   ├── streaming/
│   │   ├── sse.ts               # Server-Sent Events for streaming insights
│   │   └── websocket.ts         # WebSocket for live dashboard refresh
│   └── grpc-clients/            # imported from packages/lib-grpc-clients
└── package.json
```

#### 6.2 tRPC Surface

Mirror every analytics-service gRPC RPC as a tRPC query/mutation. Naming: `trpc.analytics.pnl.useQuery({ from, to, filters })`.

Streaming endpoints use SSE: `trpc.intelligence.pageInsight.useSubscription(...)`.

#### 6.3 Frontend Cutover (`apps/frontend/`)

Per page, replace:
- `fetch('/api/_brain/pnl?...')` → `trpc.analytics.pnl.useQuery(...)`
- `fetch('/api/workspaces/[slug]/pnl?...')` (Looqus original) → also `trpc.analytics.pnl.useQuery(...)`

Both old paths converge to the same tRPC call. Per-workspace flag still gates whether the tRPC call ultimately hits `analytics-service` (new) or `apps/frontend/lib/metrics/` (old, via a fallback REST proxy in api-gateway during transition).

#### 6.4 Auth & Multi-Tenancy

- Supabase JWT validation in api-gateway.
- Extract `active_workspace_id` claim.
- Propagate to every downstream gRPC call via metadata.
- Every downstream gRPC handler enforces `request.workspace_id == metadata.workspace_id`.

#### 6.5 Rate Limiting

Per the spec (Section 9, "Per-Workspace Rate Limits"):
- Frontend → api-gateway: 1,000 req/min/user, 5,000 req/min/workspace.
- AI Chat: 50 msg/min/user, daily token budget per workspace.
- Public API (later phase): tiered.
- Enforced via Redis sliding window.

### Non-Disruption Guarantee

- Looqus's `apps/frontend/app/api/workspaces/[slug]/*` routes continue to exist and serve as fallback.
- The frontend chooses between tRPC (new) and direct fetch (old) per page based on flag.
- Phase 7 deletes the old routes; not this phase.

### Exit Criteria

- api-gateway running locally + in staging.
- Every page in `apps/frontend/` has been refactored to call tRPC instead of direct `/api/workspaces/[slug]/*` routes.
- Auth round-trip works: invalid JWT → 401; valid JWT with wrong workspace_id → 403.
- Rate limits trigger at thresholds.
- SSE streaming works for at least one intelligence endpoint.

### Cursor Hints

- tRPC routers are thin. They validate input with zod, call gRPC, return the response. No business logic.
- For routes the frontend hasn't fully migrated, api-gateway can implement them as REST passthroughs to the Next.js app temporarily.

---

## Phase 7 — Intelligence Service (AI Engine)

**Mission:** Move all AI/ML out of `apps/frontend/module/ai-engine/` (Next.js TS) into `apps/intelligence-service/` (Python + Anthropic SDK).

> **Critical:** Per `CLAUDE.md`, `module/ai/`, `lib/ai-calc/`, `lib/insights/` are dead code. Never copy from them. `module/ai-engine/` is the only legitimate prior art; even so, this phase re-implements rather than ports — the TS engine becomes obsolete.

### Deliverables

#### 7.1 Service Skeleton (`apps/intelligence-service/`)

```
apps/intelligence-service/
├── src/
│   ├── main.py
│   ├── providers/
│   │   ├── base.py                  # Provider ABC: complete, stream, embed
│   │   ├── claude.py                # Anthropic SDK with prompt caching
│   │   ├── openai.py                # secondary
│   │   ├── ollama.py                # local
│   │   └── router.py                # selection + fallback
│   ├── config/
│   │   └── workspace_ai_config.py
│   ├── context_adapters/            # one per analytics page
│   │   ├── base.py                  # PageContext, InsightContext types
│   │   ├── pnl.py
│   │   ├── acquisition.py
│   │   ├── cohorts.py
│   │   ├── ltv.py
│   │   ├── first_product_cascade.py
│   │   ├── customer_lifecycle.py
│   │   ├── timings.py
│   │   ├── distributions.py
│   │   ├── products.py
│   │   ├── inventory.py
│   │   ├── meta_ads.py
│   │   ├── google_ads.py
│   │   ├── logistics.py
│   │   ├── rto.py
│   │   ├── pincode.py
│   │   ├── cod_prepaid.py
│   │   ├── calendar.py
│   │   ├── email_sms.py
│   │   └── global_.py               # cross-page synthesis
│   ├── analysis/
│   │   ├── comparator.py            # period-over-period
│   │   ├── anomaly.py               # z-score + IQR + isolation forest
│   │   └── trend.py
│   ├── forecasting/
│   │   ├── prophet_model.py
│   │   ├── isotonic.py
│   │   └── plan_module.py           # aMER curve + retention + festival multipliers
│   ├── prompts/
│   │   ├── system.py
│   │   └── page/
│   │       └── …                    # one per page
│   ├── pipeline/
│   │   ├── page_insight.py
│   │   ├── global_insight.py
│   │   └── chat.py
│   ├── cache/
│   │   └── insight_cache.py         # Postgres ai_insights table
│   ├── grpc/
│   │   └── insights_service.py
│   └── publish/
│       └── kafka.py                 # intelligence.*.v1
└── pyproject.toml
```

#### 7.2 Provider Layer

- Default provider: Claude Sonnet 4.6 for reasoning, Haiku 4.5 for cheap drafts.
- Prompt caching ON for system prompts + reusable context blocks (per spec, ~30x cost reduction).
- Fallback chain: Claude → OpenAI → Ollama (if local).
- Workspace can override provider via `WorkspaceAIConfig`.

#### 7.3 Context Adapters

Each context adapter:
1. Calls analytics-service gRPC to get pre-aggregated metrics (NEVER raw rows).
2. Runs `analysis/comparator.py` to compute period-over-period.
3. Runs `analysis/anomaly.py` to flag statistical outliers.
4. Returns a structured `PageContext` object ≤ 2,000 tokens when serialized.

#### 7.4 Pipeline

```
adapter.build_context()
    → analysis.compare + detect_anomalies
    → prompts.page.<page>.render(context)
    → provider.stream(prompt, system=cached_system_prompt)
    → cache.save(insight)
    → publish intelligence.insight.generated.v1
    → yield tokens to client via gRPC stream
```

#### 7.5 AI Chat

- Tool use: chat agent has tools to call analytics-service over gRPC for any metric.
- Tools registered with Claude as function calls.
- Streaming via gRPC server streaming → api-gateway SSE → frontend.
- Chat history persisted in Postgres `ai_chat_threads`/`ai_chat_messages`.

#### 7.6 Forecasting (Plan Module)

- Prophet for time-series forecasts (revenue, orders, ad spend).
- Isotonic regression for budget → revenue curves.
- Festival multipliers via regional adapter (Phase 9).
- Outputs published to `intelligence.forecast.generated.v1`.

#### 7.7 Anomaly Detection

- Daily job per workspace.
- For every metric in `daily_metrics`: z-score on 30-day window; IQR fallback for non-normal distributions.
- Severity: WARN (|z| > 2), CRITICAL (|z| > 3).
- Publishes `intelligence.anomaly.detected.v1` consumed by notifications-service.

#### 7.8 Insight Cache

- Postgres `ai_insights` table from Phase 1.
- Cache key: `hash(workspace_id + page + date_from + date_to + filters)`.
- TTL: 6 hours default.
- Stale-while-revalidate: serve cached, regenerate in background, push update via SSE.

### Non-Disruption Guarantee

- `apps/frontend/module/ai-engine/` and `apps/frontend/module/ai/` remain on disk (unused).
- AI panel in the frontend points to intelligence-service via api-gateway tRPC.
- Old `app/api/workspaces/[slug]/ai-engine/*` routes (if they exist) become thin proxies.

### Exit Criteria

- Page-insight pipeline works for all 18 pages from Phase 5.
- Global cross-page insight works.
- AI Chat with tool use returns answers grounded in real ClickHouse data.
- Prompt cache hit rate ≥ 80% across requests.
- Anomaly job runs daily; alerts publish to Kafka.
- Forecast accuracy: 30-day forecast within 15% MAPE on Sugandh Lok historical data.

### Cursor Hints

- **No raw rows to LLMs.** Ever. Every adapter consumes analytics-service aggregates.
- 2,000 token budget. Compress with summary stats, not raw arrays.
- For chat tool use, register one tool per metric RPC. Claude decides which to call.
- Stream tokens; never block on full completion.

---

## Phase 8 — Notifications Service

**Mission:** Outbound alerts, digests, exports. Consumes intelligence/analytics events; dispatches via email/Slack/WhatsApp/in-app.

### Deliverables

#### 8.1 Service Skeleton (`apps/notifications-service/`)

```
apps/notifications-service/
├── src/
│   ├── server.ts
│   ├── consumers/
│   │   ├── anomalies.ts            # intelligence.anomaly.detected.v1
│   │   ├── insights.ts             # intelligence.insight.generated.v1
│   │   └── daily.ts                # analytics.metrics.daily_materialized.v1 → digests
│   ├── dispatch/
│   │   ├── email.ts                # AWS SES (React Email templates)
│   │   ├── slack.ts                # webhook
│   │   ├── whatsapp.ts             # Gupshup / AiSensei
│   │   └── in_app.ts               # writes to in_app_notifications
│   ├── digests/
│   │   ├── daily.ts
│   │   └── weekly.ts
│   ├── exports/
│   │   ├── csv.ts
│   │   ├── xlsx.ts                 # exceljs
│   │   ├── pdf.ts                  # headless Chromium via puppeteer
│   │   └── job_runner.ts           # writes to S3 + signed URL
│   ├── alert_rules/
│   │   └── evaluator.ts
│   └── grpc/
│       └── notifications_service.ts
└── package.json
```

#### 8.2 Alert Rule Engine

- Reads `alert_rules` from core-service.
- On every consumed event, evaluates matching rules.
- Fires alert → writes `alert_events` → dispatches via configured channels.

#### 8.3 Daily/Weekly Digests

- EventBridge schedule triggers digest composition.
- Pulls last day/week of metrics + insights from analytics-service + intelligence-service.
- Renders React Email template.
- Sends via SES.

#### 8.4 Exports

- CSV/XLSX/PDF jobs queued via gRPC.
- Background worker runs jobs, uploads to S3, returns signed URL.
- PDF via headless Chromium (one Docker layer with `playwright-core` + Chromium).
- Job state in `export_jobs` table.

### Non-Disruption Guarantee

- Looqus's existing email send paths (if any) keep working until this phase exits.
- Migrate any existing Klaviyo template rendering or email cron jobs (if Looqus has them) into notifications-service.

### Exit Criteria

- Daily digest received in test inbox for at least one workspace.
- Anomaly fires → Slack message in < 60s.
- Export job: request → S3 signed URL in < 30s for 1M-row CSV.
- React Email templates render correctly on Gmail/Outlook/Apple Mail.

---

## Phase 9 — Old Code Sunset

**Mission:** Delete the dead and deprecated code. Frontend becomes a thin Next.js shell.

### Deliverables

- Verify every page in `apps/frontend/` has its flag flipped to Brain on **every** production workspace for at least 7 days with no incidents.
- Delete from `apps/frontend/`:
  - All of `app/api/workspaces/[slug]/*` routes (replaced by api-gateway tRPC).
  - All of `app/api/integrations/**/sync` routes (replaced by ingestion-service + EventBridge).
  - All of `app/api/cron/*` routes (replaced by EventBridge → ingestion-service).
  - `lib/metrics/`, `lib/cogs/`, `lib/pnl/`, `lib/acquisition/`, `lib/cohorts/`, `lib/ltv/`, `lib/timings/`, `lib/distributions/`, `lib/products/`, `lib/workspace-metrics/`, `lib/email-performance/`.
  - `lib/ai-calc/`, `lib/insights/`.
  - `module/ai/`, `module/ai-2/` (any stale variant), `module/ai-engine/`.
  - `lib/integrations/` (replaced by ingestion-service).
  - `lib/shopify/` (replaced by ingestion-service).
- Keep in `apps/frontend/`:
  - `app/(protected)/w/[slug]/<page>/page.tsx` — UI only.
  - `components/` — UI components.
  - `app/api/auth/*` — Supabase auth callbacks (until api-gateway absorbs them).
  - `lib/client.ts`, `lib/server.ts` — Supabase clients for session reads only.
  - `middleware.ts` — auth middleware.
- Update `apps/frontend/CLAUDE.md` to reflect the new architecture.
- Remove all per-page feature flags (no longer needed).

### Non-Disruption Guarantee

- Pre-deletion checklist: every page tested on staging + production. Rollback plan: git revert the deletion PR; flags default back to TS (TS code is recoverable from git history if absolutely needed within 30 days).

### Exit Criteria

- `apps/frontend/` is < 25k lines (down from current). Almost entirely UI.
- No `lib/metrics`, `lib/cogs`, etc. in the repo.
- Frontend bundle size reduced significantly.
- All metric calls in browser DevTools network tab go to api-gateway only.

---

## Phase 10 — Regional Adapters

**Mission:** Pluggable region-specific economics (RTO, COD, GST, pincode for India; placeholder for US/EU).

### Deliverables

#### 10.1 Interface (`packages/lib-regional/`, `pylibs/brain_regional/`)

```python
class RegionAdapter(ABC):
    region_code: str

    def get_currency(self) -> str: ...
    def get_timezone(self) -> str: ...
    def get_tax_model(self) -> TaxModel: ...
    def has_cod(self) -> bool: ...
    def has_rto(self) -> bool: ...
    def get_festival_calendar(self) -> list[Festival]: ...
    def compute_pincode_reliability(self, ...) -> ...: ...
```

#### 10.2 India Adapter

- RTO prediction (uses Shiprocket data + ML model from intelligence-service).
- COD-vs-prepaid economics.
- GST tax model.
- Pincode reliability lookups.
- Indian festival calendar.

#### 10.3 Workspace Configuration

- `Workspace.home_region` field (already added in Phase 1).
- analytics-service queries route through `RegionAdapter.get(workspace.home_region)`.
- Festival overlay rendered on all time-series charts when region has festivals.

### Exit Criteria

- All Looqus features that today are India-hardcoded (RTO calcs, COD splits, GST, pincode, festivals) flow through `RegionAdapter`.
- Stubbed `USAdapter` and `EUAdapter` exist with reasonable defaults (no RTO, no COD, sales-tax model).

---

## Phase 11 — AWS Infrastructure (CDK)

**Mission:** Bring up production AWS via CDK. Until this phase, everything runs locally (Docker Compose) or on the existing Looqus deployment.

### Deliverables

#### 11.1 CDK Stacks (`infra/stacks/`)

- `network.ts` — VPC, public/private subnets, NAT, security groups
- `compute.ts` — EKS cluster, Karpenter, node groups, IRSA
- `data.ts` — Supabase peering (or RDS), ClickHouse Cloud peering (or self-host on EKS via Altinity Operator), ElastiCache Redis cluster
- `kafka.ts` — MSK cluster (6 brokers, 3 AZs), MSK Connect for Debezium (Postgres CDC → ClickHouse), Glue Schema Registry
- `storage.ts` — S3 buckets (raw events, exports), CloudFront distribution for frontend
- `observability.ts` — CloudWatch dashboards, alarms, X-Ray, Sentry/PostHog secrets
- `security.ts` — IAM roles per service (IRSA), AWS Secrets Manager, KMS keys, WAF rules

#### 11.2 GitOps with ArgoCD

- `infra/k8s/` — Kubernetes manifests per service (Deployment, Service, Ingress, HPA, NetworkPolicy).
- ArgoCD installed via Helm.
- One Application per service syncing from `infra/k8s/<service>/`.

#### 11.3 CI/CD (`.github/workflows/`)

- `lint → typecheck → test → build → push to ECR → ArgoCD sync` per service.
- One workflow per service in `apps/`. Triggered on changes to that service's path (using `paths` filter).
- Turborepo remote cache speeds incremental builds.

#### 11.4 Observability

- CloudWatch Logs: structured JSON, retention 30 days.
- CloudWatch Metrics: custom namespace per service.
- X-Ray: tracing across gRPC boundaries (Brian-trace headers propagated).
- Sentry: error tracking for all services.
- PostHog: product analytics on frontend.
- Dashboards: per-service latency, error rate, Kafka lag, ClickHouse query time, gRPC call rate.

### Non-Disruption Guarantee

- Looqus production stays on its current host (Vercel/whatever) until all services are running on EKS.
- Phase 11 spins up Brain in parallel; cutover is a DNS flip in Phase 12.

### Exit Criteria

- `cdk deploy --all` from scratch in a new AWS account brings up the full Brain environment.
- One pod per service running on EKS.
- All inter-service gRPC calls work.
- Frontend deployed and serving traffic at `brain.pipadacapital.com` (staging hostname initially).

---

## Phase 12 — Scale Hardening & Cutover

**Mission:** Make Brain handle production load. DNS flip Looqus → Brain.

### Deliverables

#### 12.1 Scale Hardening

- PgBouncer in front of Postgres (transaction mode, 10k client → 200 backend connections).
- Postgres read replicas (2 replicas in Phase 12; route analytics-service reads of `ai_insights` to replicas).
- ClickHouse cluster scaling (3 shards × 2 replicas; tunable to 6 shards at 50k+ workspaces).
- MSK auto-scaling, Kafka tiered storage to S3 (infinite retention for `integrations.*`).
- ElastiCache cluster mode (3 → 12 shards based on memory pressure).
- Per-workspace rate limits enforced.

#### 12.2 Load Testing

- k6 scripts in `tools/loadtest/` simulating 5K RPS sustained, 20K RPS peak.
- Soak test 24 hours. Verify: no memory leaks, no Kafka lag accumulation, no ClickHouse query degradation.

#### 12.3 Cutover Plan

1. Pre-flight: every metric flag at 100% on Brain for 14 days.
2. Sync any final Looqus-only state (last Stripe events, etc.) to Brain core-service.
3. Set Looqus DNS TTL low (60s).
4. DNS flip: `app.pipadacapital.com` → CloudFront → ALB → api-gateway/frontend.
5. Watch dashboards for 24 hours. Rollback = DNS revert + low TTL = fast.
6. Decommission Looqus deployment after 7 days of stable Brain operation.

### Exit Criteria

- Brain sustains 5K RPS without degradation.
- Cutover complete; Looqus deployment torn down.
- All operators using Brain daily.

---

## Phase 13 — Intelligence & Scale Features (matches doc Phase 3)

**Mission:** The features that justify Brain v2 vs v1 — Plan Module, advanced anomaly detection, WebSocket live refresh, OpenSearch.

### Deliverables

- **Plan Module v1** — aMER curve + retention model + festival multipliers (intelligence-service forecasting/).
- **Anomaly detection v2** — severity classification (WARN/CRITICAL), per-metric thresholds, alert dedup.
- **Proactive AI insights** — daily run, surface in dashboard before user asks.
- **AI Chat upgrade** — Claude tool use with all metric RPCs registered.
- **Budget allocation recommendations** — given goal + history, suggest spend split across channels.
- **WebSocket live dashboard refresh** — analytics-service publishes `analytics.metrics.daily_materialized.v1`; api-gateway broadcasts to subscribed frontend clients.
- **OpenSearch (AWS managed)** — for product/customer search; replaces any Postgres `ILIKE` patterns.

### Exit Criteria

- 30-day forecasts within 15% MAPE.
- Anomaly false-positive rate < 10%.
- Live refresh delay < 5s end-to-end (event → UI).
- Search returns results in < 200ms.

---

## Phase 14 — Global Expansion (matches doc Phase 4)

**Mission:** Multi-region deploy. First non-Indian customers.

### Deliverables

- **US/EU RegionAdapter** — multi-currency, multi-timezone, regional tax models.
- **Multi-region deploy** — primary ap-south-1 (Mumbai), secondary us-east-1 (N. Virginia).
- **Read replicas in target regions** — Postgres + ClickHouse for sub-100ms dashboard reads.
- **Cross-region Kafka mirroring** — MirrorMaker 2 (secondary region is read-only initially).
- **Additional integrations** — Klaviyo (full), TikTok, Snapchat ads.
- **Multi-3PL** — Delhivery, Bluedart direct (alongside Shiprocket).
- **Public REST API** — rate-limited per tier (Starter/Pro/Enterprise).
- **iROAS** via geo-holdouts.
- **SOC 2 Type 1** compliance audit.

### Exit Criteria

- First non-Indian customer onboarded and using Brain daily.
- 100k req/min sustained globally.
- SOC 2 Type 1 report issued.

---

## Appendix A — Per-Phase Disruption Risk Matrix

| Phase | Files Touched in `apps/frontend/` | Live Pages at Risk | Rollback |
|-------|-----------------------------------|--------------------|----------|
| 0 | Move only (no edits) | None | `git revert` |
| 1 | None | None | n/a |
| 2 | None | None | n/a |
| 3 | None | None | n/a |
| 4 | None | None | n/a |
| 5 | Per-page flag added; default off | None when flag off | Flag off |
| 6 | Per-page fetch → tRPC | All (gated by flag) | Flag off; revert tRPC PRs |
| 7 | AI panel switches to intelligence-service | AI insights only | Flag off |
| 8 | None (notifications backend only) | None | n/a |
| 9 | Mass deletion | All | Restore from git |
| 10 | None | None | n/a |
| 11 | Deploy target | All (cutover only) | DNS revert |
| 12 | None | All (cutover) | DNS revert |
| 13 | New features only | None | Feature flag off |
| 14 | New features only | None | Feature flag off |

---

## Appendix B — Looqus File → Brain Destination Map

| Looqus path (before) | Brain path (after) | Notes |
|----------------------|-------------------|-------|
| `app/(protected)/w/[slug]/` | `apps/frontend/app/(protected)/w/[slug]/` | UI only |
| `app/api/workspaces/[slug]/*` | `apps/api-gateway/src/trpc/routers/analytics.ts` | Plus analytics-service handlers |
| `app/api/integrations/**` | `apps/ingestion-service/src/connectors/*` | |
| `app/api/cron/*` | EventBridge → `apps/ingestion-service` | |
| `app/api/shopify/*` | `apps/ingestion-service/src/connectors/shopify.py` | |
| `lib/metrics/*` | `apps/analytics-service/src/queries/*` | Port to Python |
| `lib/cogs/*` | `apps/analytics-service/src/queries/cogs.py` | |
| `lib/pnl/*` | `apps/analytics-service/src/queries/pnl.py` | |
| `lib/acquisition/*` | `apps/analytics-service/src/queries/acquisition.py` | |
| `lib/cohorts/*` | `apps/analytics-service/src/queries/cohorts.py` | |
| `lib/ltv/*` | `apps/analytics-service/src/queries/ltv.py` | |
| `lib/timings/*` | `apps/analytics-service/src/queries/timings.py` | |
| `lib/distributions/*` | `apps/analytics-service/src/queries/distributions.py` | |
| `lib/products/*` | `apps/analytics-service/src/queries/products.py` | |
| `lib/workspace-metrics/*` | `apps/analytics-service/src/queries/workspace_metrics.py` | |
| `lib/email-performance/*` | `apps/analytics-service/src/queries/email_performance.py` | |
| `lib/festivals/*` | `pylibs/brain_regional/india/festivals.py` | Via RegionAdapter |
| `lib/integrations/*` | `apps/ingestion-service/src/connectors/*` | |
| `lib/shopify/*` | `apps/ingestion-service/src/connectors/shopify.py` | |
| `lib/effective-daily.ts` | `apps/analytics-service/src/queries/effective_daily.py` | |
| `lib/order-filters.ts` | `apps/analytics-service/src/queries/order_filters.py` | |
| `lib/workspace-costs.ts` | `apps/analytics-service/src/queries/workspace_costs.py` | |
| `lib/shiprocket-charges.ts` | `apps/analytics-service/src/queries/shiprocket_charges.py` | |
| `lib/ai-calc/*` | DELETE | Dead code |
| `lib/insights/*` | DELETE | Dead code |
| `module/ai/*` | DELETE | Dead code |
| `module/ai-2/*` | DELETE | Dead code |
| `module/ai-engine/*` | DELETE (re-implemented as `apps/intelligence-service/*`) | |
| `prisma/schema.prisma` | `apps/core-service/prisma/schema.prisma` | |
| `components/*` | `apps/frontend/components/*` | UI only |
| `middleware.ts` | `apps/frontend/middleware.ts` | Until auth moves to api-gateway |

---

## Appendix C — Cursor Standing Instructions

Before starting any phase task, Cursor MUST:

1. Re-read this plan + the relevant section of `Technical Document.pdf`.
2. Re-read `CLAUDE.md` for the project-wide rules.
3. Check `apps/frontend/` current state — running production. **Don't break it.**
4. Confirm the current phase has no incomplete items above it (no skipping).
5. When porting a Looqus function to Python, **read the original TS implementation line by line first.** Don't guess; mirror behavior, then optimize.
6. When in doubt about a metric definition, the original TS is the source of truth (until that TS is deleted in Phase 9, at which point the Python is the source of truth).
7. Every Python query MUST go through `pylibs/brain_clickhouse/query.py::WorkspaceScopedQuery` — direct ClickHouse client use is forbidden.
8. Every Postgres write MUST happen inside `pylibs/brain_db.with_workspace(workspace_id)` context — RLS depends on it.
9. Every gRPC handler MUST validate `metadata.workspace_id == request.workspace_id` as its first action.
10. Every Kafka event MUST be Avro-encoded against the schema in `protos/events/`.
11. Run parity tests before flipping any flag. No exceptions.
12. Never use raw SQL in TS/Node code; never use raw SQL in Python except via `pylibs/brain_clickhouse/`.
13. Currency: every numeric value carries explicit currency. Default INR. UI renders in workspace currency.
14. UTC for every date boundary; convert to workspace timezone at the UI layer only.
15. No comments unless explaining a non-obvious WHY (per `CLAUDE.md`).

---

## End of Plan

When you complete a phase, update the checkbox above and move to the next. Each phase is gated by its Exit Criteria — do not advance until all are met.
