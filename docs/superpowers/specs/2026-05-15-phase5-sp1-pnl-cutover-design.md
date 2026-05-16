# Phase 5 SP-1 — `/pnl` Cutover Design

**Date:** 2026-05-15
**Status:** Approved (pending user review of this spec)
**Phase:** 5 (Metric Migration), Sub-Project 1 of N
**Source plan section:** `BRAIN_PHASED_PLAN.md` Phase 5.1 (`/pnl`), 5.2 (per-page recipe), 5.3 (shared calc lib), 5.4 (caching)
**Branch:** `phase-5-sp1-pnl-cutover` (off `main`, after SP-1 infra merge)

---

## Summary

Replace Looqus's TypeScript `/pnl` calculation pipeline with a new Python `analytics-service` and add Redis caching, behind a per-page feature flag, with strict parity gating the cutover. This is the first vertical slice of Phase 5 ("The Big Cutover"): one page, end-to-end, producing all the reusable machinery (proto + gRPC, shared Python calc utilities, Redis cache layer, Next.js proxy, parity test harness) that subsequent page migrations only have to fill in for their own specific metric.

The new service reads the **same Supabase Postgres that Looqus already writes to** — no ClickHouse, no Kafka, no ingestion-service. Speed wins come from Redis caching + better aggregation queries. ClickHouse + ingestion are deferred to later phases when they're actually needed.

The intelligence/AI layer is explicitly out of scope and deferred until after the metric migration is well underway.

---

## Where this fits in the phased plan

Original `BRAIN_PHASED_PLAN.md` ordering: Phase 0 (monorepo) → Phase 1 (data plane: Docker, schemas, contracts, tenancy) → Phase 2 (ingestion) → Phase 3 (core-service) → Phase 4 (analytics-service consumers + materialized views) → **Phase 5 (metric migration)** → Phase 6 (api-gateway) → Phase 7 (intelligence).

What's actually been done: Phase 0 (merged), Phase 1 SP-1 (local Docker stack — merged in PR #5). Phase 1 SP-2 (DB schemas + service scaffolds) was specified, planned, and partly started (a `core-service` Fastify skeleton was committed on its branch) but is now **paused mid-execution** — the user has re-prioritized.

This sub-project deliberately **jumps over Phases 2/3/4** by:
- Reading from the existing Supabase Postgres rather than building Phase-2 ingestion → Phase-4 ClickHouse consumers.
- Skipping core-service entirely; the `/pnl` proxy talks to analytics-service directly.
- Building only the `metrics.proto` slice that `/pnl` needs, not the full Phase 1.4 SP-3 protobuf surface.

The SP-2 work (`phase-1-sp2-db-schemas` branch with spec + plan + Task 1 commits) is **archived in place** — not merged, not deleted. The schema design remains valid for when core-service / auth / RLS work resumes after the metric migration is sufficiently underway.

---

## Phase 5 decomposition (this sub-project + what follows)

This spec covers the first page only. The page list below tracks the rest:

| SP | Page(s) | Status |
|---|---|---|
| **Phase 5 SP-1** | **`/pnl`** | **This spec** |
| Phase 5 SP-2+ | `/waterfall`, `/acquisition`, `/cohorts`, `/lifetime-value`, `/timings`, `/distributions`, `/customer-lifecycle`, `/first-product-cascade`, `/meta-ads`, `/google-ads`, `/products`, `/inventory`, `/logistics`, `/rto-analytics`, `/pincode-intelligence`, `/cod-prepaid`, `/calendar`, `/email-sms`, `/store/*` | Spec per batch to follow |

Every page after the first reuses the proto stub, gRPC server, Redis layer, proxy pattern, parity-test harness, and most of the shared Python calc lib produced here.

---

## Decisions log

| # | Decision | Choice | Reasoning |
|---|---|---|---|
| Q1 | Data source for the new analytics-service | **Supabase Postgres direct (shortcut)** | Bypasses Phase 2 ingestion + ClickHouse entirely — months of work avoided. Speed gains come from Redis + better queries, not OLAP. ClickHouse can be introduced later. |
| Q2 | First-batch scope | **`/pnl` only** | Heaviest single page; proves the architecture end-to-end. All shared utilities are de-risked by being used in a real page. Subsequent SPs port the next batches. |
| Q3 | Transport between Next.js proxy and analytics-service | **gRPC (per the plan)** | Architecturally correct foundation; the `protos/analytics/metrics.proto` slice we build here serves every later page. Folds protobuf scaffolding into this sub-project. |
| Q4 | Sub-project shape | **Vertical slice for `/pnl`, end-to-end** | Alternative (split into "foundations SP" + "page SP") produces no user-visible value at the first gate. Building shared utilities in isolation invites overfitting. |
| Q5 | Redis placement | **Inside analytics-service gRPC handler** | Plan's pattern (Phase 5.4); the proxy stays thin and stateless. |
| Q6 | Feature flag style | **Env var `BRAIN_PNL_ENABLED` (all-or-nothing)** | Per-workspace flag is rollout-stage work; first-cutover gate is "does this work at all". Env var is enough for the proof. |
| Q7 | Parity gate | **Strict — every numeric field within 0.01% of the existing TS endpoint, automated** | Plan-mandated; the only safe cutover discipline. Eyeball-only is how prod regressions ship. |
| Q8 | SP-2 (DB schemas) work-in-progress | **Archive in place on its branch** | The schema design is correct and reusable when core-service / auth / RLS work resumes. Not merged, not deleted. |
| Q9 | Branch + naming | **`phase-5-sp1-pnl-cutover` off `main`** | Honest mapping to the phased plan; previous SP-1/SP-2 numbers stay reserved for the deferred Phase 1 infra/schema work. |

---

## Section 1 — Architecture & components

```
┌─────────────────────────────────────────────────────────────────────┐
│  apps/frontend/  (Next.js — already exists, lightly touched)        │
│                                                                      │
│  /pnl page  ─┬─► env BRAIN_PNL_ENABLED?                             │
│              │                                                       │
│              ├─ true ──► fetch /api/_brain/pnl  (NEW thin proxy) ──┐│
│              └─ false ─► fetch /api/workspaces/[slug]/pnl  (old)  ││
└────────────────────────────────────────────────────────────────────││┘
                                                                     ││
                                                          gRPC over  ││
                                                          loopback   ││
                                                                     ▼▼
┌─────────────────────────────────────────────────────────────────────┐
│  apps/analytics-service/  (Python, FastAPI + grpc.aio — NEW)        │
│                                                                      │
│  src/grpc/metrics_service.py::GetPnL                                │
│       │                                                              │
│       ├─► Redis ─ check cache (key = analytics:pnl:<ws>:<hash>)    │
│       │   hit:  return cached PnLResponse                           │
│       │   miss: ↓                                                   │
│       │                                                              │
│       └─► src/queries/pnl.py — aggregations against Supabase via   │
│           asyncpg, using src/lib/{cogs,order_filters,workspace_     │
│           costs,date_buckets,…}.py                                   │
│           writes result → Redis (TTL 60s) → returns                  │
└─────────────────────────────────────────────────────────────────────┘
                                       │                    ▲
                                       ▼                    │
                          ┌──────────────────────┐  ┌──────────────────┐
                          │  Supabase Postgres   │  │  Redis (SP-1     │
                          │  (existing — same DB │  │   stack)         │
                          │   Looqus uses today, │  │  127.0.0.1:6379  │
                          │   untouched)         │  │                  │
                          └──────────────────────┘  └──────────────────┘
```

### Six units, one job each

| # | Unit | What it does | Depends on |
|---|---|---|---|
| 1 | `protos/analytics/metrics.proto` (new) | Declares `MetricsService.GetPnL` + `GetPnLRequest`/`PnLResponse`. Single source of truth for the Node↔Python wire contract. Slice of the eventual full `metrics.proto` — only `/pnl` for now. | nothing |
| 2 | `packages/lib-grpc-clients/` (new TS) + `pylibs/brain_grpc/` (new Python) | Generated gRPC clients in both languages, produced by `buf generate`. | (1) |
| 3 | `apps/analytics-service/` (Python — fresh; supersedes any partial scaffold from SP-2) | FastAPI for `/health`, gRPC server for `MetricsService`, Redis client, asyncpg pool to Supabase Postgres. Owns: `src/grpc/metrics_service.py`, `src/queries/pnl.py`, `src/lib/{cogs,order_filters,workspace_costs,date_buckets,effective_daily,customer_first_order,ads_classification,shiprocket_charges,store_currency,currency}.py`, `src/cache/redis.py`. | (2) |
| 4 | `apps/frontend/app/api/_brain/pnl/route.ts` (new, thin) | Auth check + workspace membership + featureGuard, then calls the generated gRPC client and returns the JSON response. No business logic. | (2), (3) |
| 5 | `apps/frontend/app/(protected)/w/[slug]/pnl/page.tsx` (modified, ~5 lines) | Reads `process.env.NEXT_PUBLIC_BRAIN_PNL_ENABLED`; when true, fetches `/api/_brain/pnl`; else falls back to existing `/api/workspaces/[slug]/pnl`. | (4) |
| 6 | `apps/analytics-service/tests/parity/pnl_test.py` (new) | For each fixture (workspace, from, to, granularity), hits old + new endpoints and asserts numeric parity within 0.01%. | (3), (4) |

Plus `tools/codegen-proto.sh` — small shell script wrapping `buf generate`. Re-run whenever `metrics.proto` changes.

### What this sub-project deliberately doesn't touch

- `apps/core-service/` — the Fastify skeleton stays on its SP-2 branch, untouched on `main`.
- ClickHouse, Kafka, ingestion-service, Schema Registry — none of them.
- core-service, api-gateway, intelligence-service, notifications-service — none.
- Any metric page other than `/pnl`.
- The existing Looqus `/api/workspaces/[slug]/pnl` route — unchanged; remains the fallback.

---

## Section 2 — Request lifecycle + what gets ported

### Cache-miss request flow

```
1. Browser → /pnl page renders, reads NEXT_PUBLIC_BRAIN_PNL_ENABLED=true,
            calls fetch("/api/_brain/pnl?from=...&to=...&granularity=...&filters=...")

2. Next.js /api/_brain/pnl/route.ts:
     - createClient() → Supabase auth: get user, 401 if absent
     - prisma.workspaceMember query: 403 if user not in this workspace
     - featureGuard(workspace, "pnl"): 403 if subscription doesn't include /pnl
     - parse + validate query params with zod
     - call MetricsServiceClient.getPnL({ workspace_id, from, to, granularity, filters })

3. analytics-service gRPC handler MetricsService.GetPnL:
     - validate request.workspace_id (sanity check — propagated from proxy)
     - cache key = "analytics:pnl:" + workspace_id + ":" + sha256(canonical_request_json)
     - Redis GET key → if hit, deserialize PnLResponse, return (~1-5ms total)
     - miss: ↓

4. queries/pnl.py (the actual computation):
     - load workspace settings via cogs / order_filters / workspace_costs helpers
       (read from Supabase Postgres — same DB Looqus uses)
     - bucket the requested range with date_buckets.py
     - run aggregation queries (line items, ad spend, shipping charges, refunds,
       fixed-cost allocation) per bucket
     - apply currency conversion via the same hardcoded rate table the TS route uses
       (port verbatim, do not "improve" — parity is the rule)
     - assemble the PnLResponse proto

5. cache.set(key, response, ttl=60s) → return response

6. Next.js proxy receives the gRPC response, serializes to JSON matching the exact
   shape Looqus's existing /api/workspaces/[slug]/pnl returns, NextResponse.json(...)

7. Page renders. Frontend rendering logic does not change — that's the contract.
```

Cache-hit path short-circuits at step 3: Redis lookup → deserialize → return at step 6. Sub-10ms typical.

### Shared Python calc library (`apps/analytics-service/src/lib/`)

Built in this sub-project, sized to what `/pnl` actually needs. Speculative porting of utilities the next page might use is explicitly out.

| Python file | Ports (Looqus TS source) | Purpose |
|---|---|---|
| `date_buckets.py` | `lib/pnl/buckets.ts` (192 lines) | `getBuckets`, `getBucketUtcDateStrings`, `allocateMonthlyToBucket`, `Granularity` enum |
| `shiprocket_charges.py` | `lib/shiprocket-charges.ts` | `totalChargesFromRaw` |
| `order_filters.py` | `lib/order-filters.ts` | `getOrderInclusionWhereFromWorkspace`, `getFilteredDailyAggregates`, `hasNoOrderFilters`, `isWoocommerceOrderIncluded`, `normalizeOrderFilterSettings`, `resolveWoocommerceOrderType` |
| `cogs.py` | `lib/cogs/` (155 lines, 2 files) | `computeLineItemsCogs`, `normalizeCogsSettings` |
| `workspace_costs.py` | `lib/workspace-costs.ts` | `getDailyVariableContribution` |
| `store_currency.py` | `lib/shopify/store-currency.ts` | `getShopifyStoreCurrency` |
| `currency.py` | (inline `EXCHANGE_RATES` table from the `/pnl` route) | `convert_currency` + the same hardcoded rate dict — port verbatim, do NOT pull from a new config table |
| `effective_daily.py`, `customer_first_order.py`, `ads_classification.py` | their TS counterparts | Port only the surface `/pnl` actually calls. Anything outside that surface is deferred to the next sub-project. |

### Out-of-scope for this sub-project (deliberate, listed explicitly)

- **`lib/integrations/woocommerce-sync.ts` (`ensureWooOrderTypesForOrderFilters`, `fetchLiveWoocommerceOrderTypeMap`)** — these make live HTTP calls to WooCommerce during the metric request to backfill order-type metadata. Porting requires a Python WooCommerce client + auth handling. **For this sub-project: parity-test fixture workspaces must be Shopify-only (no WooCommerce connection)**, and the Python `/pnl` falls back to `hasNoOrderFilters`-equivalent behavior when those helpers would have run. Migrating WooCommerce-aware filtering is a follow-on sub-project.

### Response contract

The gRPC handler returns a `PnLResponse` proto. The Next.js proxy serializes it to JSON with a shape **byte-identical** to what `apps/frontend/app/api/workspaces/[slug]/pnl/route.ts` returns today (same field names, types, nesting, ordering as JSON.stringify produces). The parity test enforces this. The proto definition mirrors the existing JSON shape precisely; we do not "clean up" the response in this sub-project.

### Connection management

- `asyncpg` pool to Supabase Postgres, default size 10, configurable via env (`PG_POOL_SIZE`).
- `redis.asyncio` single shared client.
- Both initialized at FastAPI/gRPC startup, closed on shutdown.

---

## Section 3 — Redis caching mechanics

Plan-faithful and minimal:

| Aspect | Choice |
|---|---|
| **Where** | Inside the gRPC handler (`MetricsService.GetPnL`), wrapping the `queries/pnl.py` call |
| **Key** | `analytics:pnl:<workspace_id>:<sha256_of_canonical_request>` — canonical request is the JSON-serialized `GetPnLRequest` with sorted keys |
| **TTL** | `60` seconds, hardcoded constant in `src/cache/redis.py` (per Phase 5.4) |
| **Value format** | The serialized `PnLResponse` proto bytes — no JSON encode/decode round-trip on the cache path |
| **Invalidation** | (a) **TTL expiry** — primary mechanism for this sub-project; (b) **manual invalidation hook** — `src/cache/redis.py` exposes `invalidate_workspace(workspace_id)` that does `DEL analytics:*:<workspace_id>:*` (via SCAN to avoid blocking). Wired but not yet *called* by anything — the Kafka-event-driven invalidation per Phase 5.4 (`operations.settings.changed.v1`) lands when Kafka actually exists. For now, settings changes wait up to 60s to propagate, which is acceptable for a first cutover. |
| **Connection** | Single shared `redis.asyncio` client at FastAPI startup, pointed at the SP-1 stack's Redis (`redis://localhost:6379`). Env var: `REDIS_URL` |
| **Failure mode** | If Redis is unreachable: log a warning, skip cache (compute every time). Never fail a request because the cache is down. |

That's the entire caching layer. Cache stampede protection, request coalescing, multi-tier are YAGNI for first cutover.

---

## Section 4 — Cutover machinery

### Feature flag (env var, all-or-nothing)

`apps/frontend/app/(protected)/w/[slug]/pnl/page.tsx` adds at the top:

```ts
const BRAIN_PNL = process.env.NEXT_PUBLIC_BRAIN_PNL_ENABLED === "true";
const PNL_ENDPOINT = BRAIN_PNL
  ? "/api/_brain/pnl"
  : `/api/workspaces/${slug}/pnl`;
```

Every existing `fetch(\`/api/workspaces/${slug}/pnl?...\`)` call in that file becomes `fetch(\`${PNL_ENDPOINT}?...\`)`. Nothing else in the page changes. Off by default; flip via `.env.local` for local testing or via deploy env vars for staging/prod.

### The proxy is thin

`apps/frontend/app/api/_brain/pnl/route.ts`:
1. Supabase auth (`createClient()` → `getUser()`); 401 if absent.
2. Workspace membership check (`prisma.workspaceMember.findFirst`); 403 if not a member.
3. `featureGuard(workspace, "pnl")`; 403 if subscription doesn't include `/pnl`.
4. Parse query params with zod.
5. Call generated `MetricsServiceClient.getPnL(...)` from `packages/lib-grpc-clients/`.
6. `NextResponse.json(response)` — the proto already serializes to the contract shape.

No business logic, no Prisma reads beyond auth/membership/featureGuard, no metric math.

### Parity test (`apps/analytics-service/tests/parity/pnl_test.py`)

For each fixture (workspace, from, to, granularity) tuple:
1. Boot the SP-1 stack (Postgres + Redis at minimum), run analytics-service locally.
2. Call the **Looqus** endpoint: `GET http://localhost:3000/api/workspaces/<slug>/pnl?from=...&to=...` — captures the "old" response.
3. Call the **new** endpoint via the gRPC client (or via `http://localhost:3000/api/_brain/pnl?...` with the flag forced on).
4. Walk both JSON trees recursively; for every numeric leaf, assert `abs(new - old) <= max(0.0001, abs(old) * 0.0001)` (0.01% tolerance with an absolute floor for tiny numbers); for every non-numeric leaf, assert exact equality.
5. Pretty-print every diff.

**Fixture workspaces:** at least one development workspace from the local Supabase instance, Shopify-only (no WooCommerce — see Section 2 out-of-scope). Implementation plan picks the actual fixture(s) and date ranges.

The parity test is the gate. Flag flip in any deployment requires green parity for that workspace's typical date ranges.

### Codegen

`tools/codegen-proto.sh` — a small new shell script that runs `buf generate` to produce TS clients into `packages/lib-grpc-clients/` and Python clients into `pylibs/brain_grpc/`. Re-run whenever `metrics.proto` changes. The proto file, generated clients, and `buf.gen.yaml` are checked in.

---

## Section 5 — Verification & definition of done

### Local verification (against the SP-1 Docker stack)

| # | Check | How | Pass criterion |
|---|---|---|---|
| 1 | proto compiles + generates clients | `bash tools/codegen-proto.sh` | exit 0; `packages/lib-grpc-clients/` and `pylibs/brain_grpc/` both populated |
| 2 | analytics-service boots | `uv run --directory apps/analytics-service uvicorn src.main:app --port 8000` + gRPC server on its own port | `GET /health` returns 200; gRPC port reachable |
| 3 | gRPC `GetPnL` returns a well-formed response | Run the gRPC client against analytics-service for a known workspace + date range | response deserializes to `PnLResponse`; numeric fields populated; latency reported |
| 4 | Cache works | Same request twice; second call is sub-10ms; `redis-cli KEYS "analytics:pnl:*"` shows the key | second-call latency < 10ms; cache key present |
| 5 | Cache failure mode | Stop Redis (`docker compose stop redis`), repeat request | request still returns correctly (no Redis = compute every time, just logged warning) |
| 6 | Proxy works end-to-end | Start frontend (`pnpm --filter shopify-analytics dev`), `BRAIN_PNL_ENABLED=true`, hit `/api/_brain/pnl` | returns same JSON shape as `/api/workspaces/[slug]/pnl` |
| 7 | Page works with flag on | Open `/pnl` in browser with the flag enabled | page renders correctly; values reasonable |
| 8 | Page works with flag off | Same, flag disabled | page renders correctly via the existing TS path (regression check) |
| 9 | **Parity test passes** | `uv run --directory apps/analytics-service pytest tests/parity/pnl_test.py` | all numeric fields within 0.01% of the old endpoint |

### CI

- `pnpm typecheck` + `build` (the new proxy route + generated TS client must compile).
- Python `ruff check` + `mypy` on analytics-service.
- Parity test is **local-only** (requires the SP-1 stack + the Next.js dev server; CI doesn't run those).

### Definition of done

- [ ] Checks 1–9 pass locally
- [ ] `pnpm typecheck` + `build` green across the workspace
- [ ] CI green
- [ ] PR opened, user squash-merges
- [ ] After merge: enable `BRAIN_PNL_ENABLED=true` in dev `.env.local` and confirm `/pnl` renders correctly in the browser

---

## Risks & rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| Numeric drift between TS and Python implementations (rounding, float vs Decimal) | High | Use Python `decimal.Decimal` throughout the calc layer (mirrors Prisma's `Decimal`); parity test is the gate; 0.01% tolerance has an absolute floor to handle tiny-number rounding |
| Hardcoded `EXCHANGE_RATES` table drifts between TS and Python copies | Medium | Both are hardcoded constants; audit at PR review. A shared config source is a follow-on cleanup, not a first-cutover concern. |
| asyncpg connection pool exhaustion under load | Low locally | Pool size configurable; first cutover is dev/single-user; production pool sizing is a Phase 6+ concern |
| WooCommerce-using workspaces hit the un-ported code path | Medium → blocked by gating | Flag is per-deploy env var: enable only for environments / dev `.env.local` whose accessible workspaces are Shopify-only. Document the constraint loudly. |
| Redis unavailable in production | Low | Failure mode (Section 3) is "skip cache, compute every time" — degraded but functional |
| `featureGuard` returns differently in the Python path vs the TS route | Low | The proxy (Next.js) does the `featureGuard` check; analytics-service never sees the result. Same TS code as the Looqus route — no second implementation to drift. |
| Roll back the sub-project | Trivial | Set `BRAIN_PNL_ENABLED=false` (or unset) — page reverts to the unchanged Looqus path. `git revert <merge-commit>` removes the new code; the Looqus path is untouched. |

---

## Open questions / explicit non-decisions

- **gRPC streaming** — only unary RPC for `/pnl`. Streaming endpoints arrive when intelligence-service does (Phase 7).
- **Server-side telemetry / metrics export** from analytics-service — none in this sub-project. Add when it's the cheapest path to debugging a real problem.
- **Per-workspace feature flag** — env-var only for now. A workspace-scoped flag is rollout machinery, deferred.
- **Kafka-driven cache invalidation** — TTL only. The `invalidate_workspace` hook exists but isn't wired to any event source until Kafka actually exists.
- **Migrating any page other than `/pnl`** — out. Subsequent SPs.
- **core-service, api-gateway, intelligence-service, ingestion-service** — out.
- **ClickHouse, Kafka** — out.
- **WooCommerce-aware order filtering** — out (see Section 2). Deferred to a follow-on sub-project.
- **Data validation that the source Supabase schema matches what Looqus wrote** — assumed equivalent; no schema verification step.
- **The SP-2 (`phase-1-sp2-db-schemas`) branch's eventual fate** — no decision made here. Resurrected when core-service / auth / RLS work resumes after the metric migration is well underway.
