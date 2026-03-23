# AI Insights Engine — Complete Plan & Data Map

## Architecture Decisions (Final)

| Decision | Choice | Reason |
|----------|--------|--------|
| Primary AI provider | Claude API (`@anthropic-ai/sdk`) | Most capable, extended thinking, tool use |
| Secondary providers | OpenAI, Ollama | Fallback + free local option |
| Orchestration framework | None — direct SDKs only | No LangChain, no LlamaIndex |
| Vector DB | Skip for now → pgvector later | Already on Postgres, no new infra |
| RAG | Later — after insights accumulate | RAG needs data first |
| Calculation code location | Stays in `lib/` forever | Never duplicated into ai-engine |
| New AI code location | `module/ai-engine/` only | Never touch `module/ai/` (dead) |
| Token budget per insight | ~2,000 tokens max | Never send raw DB rows |
| Insight generation | Smart on-demand + cache | Not daily cron, not every page load |
| Cache key | hash(workspaceId + page + from + to + filters) | Per user context |
| Cache TTL | 6 hours, invalidate on sync | Balance freshness vs cost |
| Streaming | Always | UX non-negotiable |
| Save insights to DB | Yes, from day 1 | Prepares for RAG later |

---

## module/ai-engine/ — Full Structure

```
module/ai-engine/
├── providers/
│   ├── types.ts                # Unified AIProvider interface + ProviderCapabilities
│   ├── claude.ts               # @anthropic-ai/sdk — streaming, tool use, extended thinking
│   ├── openai.ts               # openai SDK — streaming, tool use
│   ├── ollama.ts               # Ollama local — streaming
│   └── router.ts               # Picks provider based on workspace config + fallback chain
│
├── config/
│   └── workspace-ai-config.ts  # Read/write AI provider settings per workspace
│                               # (provider, model, API key, insight depth)
│
├── context-adapters/           # THIN wrappers — call existing lib/ functions only
│   ├── types.ts                # PageContext, InsightContext, MetricBriefing types
│   ├── pnl.ts                  # → lib/pnl/ + lib/cogs/ + lib/workspace-costs.ts
│   ├── waterfall.ts            # → same as pnl (flat, no bucketing)
│   ├── acquisition.ts          # → lib/acquisition/compute.ts + lib/metrics/ads-spend.ts
│   ├── cohorts.ts              # → lib/cohorts/compute.ts
│   ├── lifetime-value.ts       # → lib/ltv/compute.ts
│   ├── timings.ts              # → lib/timings/compute.ts
│   ├── distributions.ts        # → lib/distributions/compute.ts
│   ├── customer-lifecycle.ts   # → lib/metrics/customer-lifecycle-report.ts
│   ├── first-product-cascade.ts# → lib/metrics/first-product-cascade.ts
│   ├── meta-ads.ts             # → lib/metrics/paid-media-funnel.ts + ads-spend.ts
│   ├── google-ads.ts           # → lib/metrics/google-funnel-aggregate.ts
│   ├── products.ts             # → lib/products/compute.ts
│   ├── inventory.ts            # → lib/workspace-metrics/ (inventory)
│   ├── logistics.ts            # → lib/workspace-metrics/logistics-summary.ts
│   ├── rto-analytics.ts        # → lib/workspace-metrics/rto-analytics.ts
│   ├── cod-prepaid.ts          # → lib/workspace-metrics/cod-prepaid-analytics.ts
│   ├── calendar.ts             # → lib/metrics/calendar-report.ts
│   ├── email-sms.ts            # → lib/email-performance/compute.ts
│   └── global.ts               # Combines multiple adapters for cross-page insight
│
├── analysis/                   # Pure math — no AI, no DB, no lib/ calls
│   ├── comparator.ts           # Period-over-period % change for any metric object
│   ├── anomaly.ts              # Z-score + IQR outlier detection
│   └── trend.ts                # Trend direction (up/down/flat) + velocity
│
├── prompts/
│   ├── system.ts               # Base system prompt (role, output format, rules)
│   └── page/                   # Per-page prompt templates (know their specific metrics)
│       ├── pnl.ts
│       ├── waterfall.ts
│       ├── acquisition.ts
│       ├── cohorts.ts
│       ├── lifetime-value.ts
│       ├── timings.ts
│       ├── distributions.ts
│       ├── customer-lifecycle.ts
│       ├── first-product-cascade.ts
│       ├── meta-ads.ts
│       ├── google-ads.ts
│       ├── products.ts
│       ├── inventory.ts
│       ├── logistics.ts
│       ├── rto-analytics.ts
│       ├── cod-prepaid.ts
│       ├── calendar.ts
│       ├── email-sms.ts
│       └── global.ts
│
├── pipeline/
│   ├── page-insight.ts         # Orchestrator: adapter → analysis → prompt → AI → cache
│   ├── global-insight.ts       # Orchestrator: all adapters → AI → cross-page insight
│   └── chat.ts                 # Streaming chat with page/global context
│
├── cache/
│   └── insight-cache.ts        # Read/write ai_insights DB table
│
├── types.ts                    # All shared types (Insight, Provider, Context, etc.)
└── index.ts                    # Public API: generatePageInsight(), generateGlobalInsight(), chat()
```

---

## How the Pipeline Works (No Code)

```
USER OPENS PAGE (e.g. P&L, date: last 30 days)
        │
        ▼
[1] CHECK CACHE
    Key: hash(workspaceId + "pnl" + from + to + filters)
    HIT (fresh <6h)  → return cached insight immediately. Done.
    HIT (stale >6h)  → return stale insight + trigger background regeneration
    MISS             → proceed to step 2
        │
        ▼
[2] CONTEXT ADAPTER (context-adapters/pnl.ts)
    Calls existing lib/pnl functions for CURRENT period
    Calls same functions for PRIOR period (auto)
    Returns: { current: PnlMetrics, prior: PnlMetrics }
        │
        ▼
[3] ANALYSIS LAYER (analysis/)
    comparator.ts  → % change for every metric (revenue +12%, CM1 -3pp...)
    anomaly.ts     → flag anything statistically unusual (z-score > 2)
    trend.ts       → overall trend direction
    Returns: { deltas, anomalies, trend } — enriched briefing
        │
        ▼
[4] BUILD PROMPT (prompts/page/pnl.ts)
    System prompt: "You are an expert ecommerce P&L analyst..."
    User prompt:   Structured metric briefing (~2,000 tokens max)
                   Includes: current metrics + % changes + anomalies
                   NEVER includes raw rows
        │
        ▼
[5] AI PROVIDER (providers/router.ts)
    Route to: Claude (primary) → OpenAI → Ollama (fallback)
    Stream response back to client
        │
        ▼
[6] CACHE + SAVE
    Save to ai_insights table (workspace, page, date range, insight text, model used)
    Update cache
        │
        ▼
[7] CLIENT receives streamed insight
    Words appear progressively — no blank loading screen
```

---

## Insight Generation Strategy

```
TRIGGER                              ACTION
─────────────────────────────────────────────────────────
Page open, no cache                 Generate immediately (streaming)
Page open, fresh cache (<6h)        Serve cache, no API call
Page open, stale cache (>6h)        Serve stale + regenerate background
Data sync completes                 Invalidate cache for that workspace
User changes date range             New cache key → generate if not cached
User clicks "Refresh Insight"       Force regenerate, update cache
User changes AI provider/model      Force regenerate
```

### Pre-generation after sync (smart UX)
When Shopify/Meta/Google sync finishes → queue background job to pre-generate
insights for the workspace's last active pages. When user opens the page, insight
is already waiting. Zero wait time.

---

## New API Routes to Create

```
app/api/workspaces/[slug]/ai-engine/
├── insights/route.ts     GET  ?page=pnl&from=2024-01-01&to=2024-01-31   (streaming)
├── global/route.ts       GET  ?from=2024-01-01&to=2024-01-31             (streaming)
├── chat/route.ts         POST { messages, page?, from?, to? }            (streaming)
└── config/route.ts       GET + PATCH  { provider, model, apiKey, depth }
```

---

## New DB Table to Create

```sql
-- ai_insights
id              uuid PK
workspace_id    uuid FK → workspaces
page            varchar(64)   -- "pnl", "cohorts", "global", etc.
date_from       date
date_to         date
filters_hash    varchar(64)   -- hash of any extra filters
context_json    jsonb         -- the metric briefing sent to AI (for debugging)
insight_text    text          -- AI's streamed response
model_used      varchar(64)   -- "claude-sonnet-4-5", "gpt-4o", etc.
provider        varchar(32)   -- "claude", "openai", "ollama"
tokens_used     int
created_at      timestamptz
-- Future RAG: add embedding vector(1536) column + backfill
```

---

## AI Switcher — Workspace Settings

```
Provider options:
  🟣 Claude (Anthropic)  → claude-haiku-3-5 / claude-sonnet-4-5 / claude-opus-4
  🟢 OpenAI              → gpt-4o-mini / gpt-4o
  ⚫ Ollama (Local/Free) → llama3.2 / mistral / qwen2.5

API Key strategy:
  BYOK (Bring Your Own Key) — user enters their own API key
  Stored encrypted per workspace
  Ollama = no key needed (free, local)

Insight depth:
  Quick  → fast/cheap model (haiku, gpt-4o-mini)
  Deep   → powerful model (sonnet, gpt-4o) + extended thinking for Claude

Per-task routing (internal):
  Page summary       → Quick model
  Anomaly reasoning  → Deep model
  Global insight     → Deep model + extended thinking
  Chat               → Deep model
```

---

## What Makes Insights Powerful (Not Just Describing Numbers)

| Weak (old) | Powerful (new) |
|------------|----------------|
| "Revenue is ₹12.4L" | "Revenue grew 18% vs prior period, driven by repeat customers who account for 61% of orders — highest repeat share in 3 months" |
| "ROAS is 3.2" | "Meta ROAS dropped from 4.1 → 3.2 in 7 days. Branded campaigns held at 4.8 but Generic collapsed to 1.9 — investigate creative fatigue" |
| "RTO rate is 18%" | "RTO is 18% but COD orders drive 94% of all RTOs. Pincodes 400001–400099 have 31% RTO rate — consider blocking or prepaid-only for this zone" |
| "CM1 is 38%" | "CM1 compressed 4pp this week. COGS flat, but variable shipping cost jumped ₹38/order — likely zone shift after adding new SKUs in Category X" |

This quality comes from:
1. Always auto-comparing current vs prior period
2. Statistical anomaly detection before prompting AI
3. Per-page prompts that know the metrics and what matters
4. AI reasons over pre-analyzed data — not raw numbers

---

## Build Order

```
PHASE 1 — Foundation
─────────────────────────────────────────────────
1. module/ai-engine/providers/  (Claude + OpenAI + Ollama + router)
2. module/ai-engine/config/     (workspace AI settings)
3. DB: ai_insights table         (prisma schema + migration)

PHASE 2 — Data Layer
─────────────────────────────────────────────────
4. module/ai-engine/analysis/   (comparator, anomaly, trend — pure math)
5. module/ai-engine/context-adapters/  (start with analytics/pnl)

PHASE 3 — AI Layer
─────────────────────────────────────────────────
6. module/ai-engine/prompts/    (system prompt + analytics page prompt)
7. module/ai-engine/pipeline/page-insight.ts
8. module/ai-engine/cache/
9. API route: /ai-engine/insights

PHASE 4 — UI
─────────────────────────────────────────────────
10. InsightPanel component (reused across all pages)
11. Wire up to analytics page first
12. AI switcher in workspace settings

PHASE 5 — All Other Pages (one by one)
─────────────────────────────────────────────────
13. pnl → waterfall → acquisition → cohorts → ltv →
    timings → distributions → lifecycle → first-product-cascade →
    meta-ads → google-ads → products → inventory →
    logistics → rto → cod-prepaid → calendar → email-sms

PHASE 6 — Global Insight
─────────────────────────────────────────────────
14. module/ai-engine/context-adapters/global.ts
15. module/ai-engine/pipeline/global-insight.ts
16. API route: /ai-engine/global
17. Global insight panel on dashboard

PHASE 7 — Chat
─────────────────────────────────────────────────
18. module/ai-engine/pipeline/chat.ts
19. API route: /ai-engine/chat (streaming)
20. Chat UI component (sidebar or panel)

PHASE 8 — RAG (Later, after insights accumulate)
─────────────────────────────────────────────────
21. Add pgvector extension to Postgres
22. Add embedding vector(1536) to ai_insights table
23. module/ai-engine/embeddings/ (OpenAI or Ollama embed)
24. module/ai-engine/rag/ (store + retrieve)
25. Inject historical context into prompts
```

---

## Every Page: Data Sources & Calculations

### 1. P&L (`/pnl`)
**API:** `/api/workspaces/[slug]/pnl`
**Prisma Tables:** ShopifyDailyAggregate, workspaceCost, metaAdDaily, googleAdDaily, shiprocketShipment
**Key lib/ functions:**
- `getBuckets()`, `getBucketUtcDateStrings()`, `allocateMonthlyToBucket()` — time bucketing
- `getFilteredDailyAggregates()` — daily aggregates with order filters
- `computeLineItemsCogs()`, `normalizeCogsSettings()` — COGS
- `getDailyVariableContribution()` — variable costs
- `totalChargesFromRaw()` — Shiprocket charges
**AI context:** Revenue trend, margin compression/expansion, cost driver changes, period comparison

---

### 2. Waterfall (`/waterfall`)
**API:** `/api/workspaces/[slug]/waterfall`
**Prisma Tables:** Same as P&L + ShopifyOrder (new/existing customer split)
**Key lib/ functions:** Same as P&L (flat, no time bucketing)
**AI context:** Which waterfall step is the biggest drag, NRC split trend

---

### 3. Acquisition (`/acquisition`)
**API:** `/api/workspaces/[slug]/acquisition`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder, ShopifyLineItem, metaAdDaily, googleAdDaily, shiprocketShipment, workspaceCost
**Key lib/ functions:**
- `computeAcquisition()`, `computeAcquisitionTrend()`, `computeAcquisitionComposition()`
- `fetchCustomerFirstOrdersInRange()` — first-time buyers
- `fetchAdSpendMapsWithClassification()` — ad spend by intent
- `resolveLineItemCogs()`, `getDailyVariableContribution()`
**AI context:** CAC trend, ROAS by platform, new customer CM2, acquisition efficiency

---

### 4. Cohorts (`/cohorts`)
**API:** `/api/workspaces/[slug]/cohorts`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder, ShopifyLineItem, shiprocketShipment, workspaceCost, workspaceMiscExpense
**Key lib/ functions:**
- `computeCohorts()` — cohort engine
- `fetchCustomerFirstOrdersInRange()`, `buildDailyRates()`, `resolveLineItemCogs()`
**AI context:** Which cohorts are strongest, repeat rate trend, LTV/CAC health

---

### 5. Lifetime Value (`/lifetime-value`)
**API:** `/api/workspaces/[slug]/lifetime-value`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder, ShopifyLineItem, shiprocketShipment, workspaceCost
**Key lib/ functions:** `computeLtv()`, `fetchCustomerFirstOrdersInRange()`, `resolveLineItemCogs()`
**AI context:** Best LTV products/segments, repeat rate by dimension, growth levers

---

### 6. Timings (`/timings`)
**API:** `/api/workspaces/[slug]/timings`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder, ShopifyLineItem
**Key lib/ functions:** `computeTimings()`, `fetchCustomerFirstOrdersInRange()`, `median()`, `mean()`
**AI context:** Reactivation window, fastest repeat products, drop-off between orders

---

### 7. Distributions (`/distributions`)
**API:** `/api/workspaces/[slug]/distributions`
**Prisma Tables:** ShopifyOrder, ShopifyLineItem
**Key lib/ functions:** `computeDistributions()`, `computeMode()`, `computeMean()`, `resolveLineItemCogs()`
**AI context:** Products with high mode/mean divergence, CM1 spread anomalies

---

### 8. Customer Lifecycle (`/customer-lifecycle`)
**API:** `/api/workspaces/[slug]/customer-lifecycle`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder
**Key lib/ functions:** `computeCustomerLifecycleReport()`, `classifyCustomerLifecycle()`, `computeChurnThresholds()`
**AI context:** Churn risk, dormant customer opportunity, active customer trend

---

### 9. First Product Cascade (`/first-product-cascade`)
**API:** `/api/workspaces/[slug]/first-product-cascade`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder, ShopifyLineItem
**Key lib/ functions:** `computeFirstProductCascade()`, `pickPrimaryFirstProductLine()`
**AI context:** Best gateway products, strongest cascade sequences, cross-sell opportunities

---

### 10. Meta Ads (`/meta-ads`)
**API:** `/api/workspaces/[slug]/meta-ads/metrics` + `/creative`
**Prisma Tables:** metaAdDaily, metaVideoCreative
**Key lib/ functions:** `addMetaDailyRowToAccumulator()`, `resolveCampaignIntent()`, `diagnoseMetaFunnel()`, `buildGoalEvaluations()`
**AI context:** ROAS trend by intent, funnel drop-off, creative fatigue signals

---

### 11. Google Ads (`/google-ads`)
**API:** `/api/workspaces/[slug]/google-ads/metrics`
**Prisma Tables:** googleAdDaily
**Key lib/ functions:** `diagnoseGoogleFunnel()`, `googleMergedFunnelSnapshot()`, `mapGoogleConversionActionToStage()`
**AI context:** Conversion rate trend, spend efficiency, funnel health

---

### 12. Products (`/products`)
**API:** `/api/workspaces/[slug]/products`
**Prisma Tables:** ShopifyProduct, ShopifyProductVariant, ShopifyOrder, ShopifyLineItem, ShopifyReturn
**Key lib/ functions:** `computeProducts()`, `resolveLineItemCogs()`, `getEffectiveDailyAggregates()`
**AI context:** Margin leaders/laggards, return rate anomalies, Pareto analysis

---

### 13. Inventory (`/inventory`)
**API:** `/api/workspaces/[slug]/inventory`
**Prisma Tables:** ShopifyProduct, ShopifyProductVariant, ShopifyInventoryLevel, ShopifyOrder, ShopifyLineItem
**Key lib/ functions:** `classifyInventoryStatus()`, `computeDaysLeft()`, `computeSellThrough()`
**AI context:** Stockout risk, overstock waste, sell-through outliers

---

### 14. Logistics (`/logistics`)
**API:** `/api/workspaces/[slug]/logistics`
**Prisma Tables:** shiprocketShipment, shiprocketOrder
**Key lib/ functions:** `getLogisticsSummary()`, `totalChargesFromRaw()`
**AI context:** Delivery rate trend, cost per shipment, RTO vs delivered ratio

---

### 15. RTO Analytics (`/rto-analytics`)
**API:** `/api/workspaces/[slug]/rto-analytics`
**Prisma Tables:** ShopifyOrder, ShopifyLineItem, shiprocketShipment, shiprocketOrder
**Key lib/ functions:** `getRtoAnalytics()`
**AI context:** RTO rate by courier/product/payment method, revenue at risk, actionable reductions

---

### 16. Pincode Intelligence (`/pincode-intelligence`)
**API:** `/api/workspaces/[slug]/pincode-intelligence`
**Prisma Tables:** shiprocketShipment (rawJson), ShopifyOrder, ShopifyLineItem
**Key lib/ functions:** `getPincodeIntelligence()`
**AI context:** High-RTO zones, high-COD zones, geographic risk concentration

---

### 17. COD vs Prepaid (`/cod-prepaid`)
**API:** `/api/workspaces/[slug]/cod-prepaid-analytics`
**Prisma Tables:** shiprocketShipment, shiprocketOrder
**Key lib/ functions:** `getCodPrepaidAnalytics()`
**AI context:** COD vs prepaid financial impact, break-even shift recommendations

---

### 18. Calendar (`/calendar`)
**API:** `/api/workspaces/[slug]/calendar-report`
**Prisma Tables:** ShopifyOrder, ShopifyLineItem, ShopifyDailyAggregate, workspaceFestival, workspaceMarketingAction
**Key lib/ functions:** `computeCalendarReport()`
**AI context:** Festival performance vs expectation, campaign impact, seasonality patterns

---

### 19. Email & SMS (`/email-sms`)
**API:** `/api/workspaces/[slug]/email-sms-report`
**Prisma Tables:** EmailPerformance
**Key lib/ functions:** `aggregateEmailPerformance()`
**AI context:** Open/click rate benchmarks, revenue per recipient trend, best performing flows

---

## Shared lib/ Functions (Never Duplicate These)

| Function | File | Used By |
|----------|------|---------|
| `getEffectiveDailyAggregates()` | `lib/effective-daily.ts` | P&L, Acquisition, Products, Distributions |
| `getOrderInclusionWhere()` | `lib/order-filters.ts` | P&L, Waterfall, RTO, Timings, Calendar, Lifecycle |
| `getFilteredDailyAggregates()` | `lib/order-filters.ts` | P&L, Waterfall |
| `getDailyVariableContribution()` | `lib/workspace-costs.ts` | P&L, Waterfall, Acquisition, Cohorts, LTV, Products |
| `normalizeCogsSettings()` | `lib/cogs/index.ts` | All pages with COGS |
| `resolveLineItemCogs()` | `lib/cogs/resolve.ts` | P&L, Acquisition, Cohorts, LTV, Products, Distributions |
| `computeLineItemsCogs()` | `lib/cogs/resolve.ts` | P&L, Waterfall |
| `totalChargesFromRaw()` | `lib/shiprocket-charges.ts` | P&L, Waterfall, Logistics |
| `getLogisticsSummary()` | `lib/workspace-metrics/logistics-summary.ts` | Logistics, P&L, Waterfall |
| `fetchCustomerFirstOrdersInRange()` | `lib/metrics/customer-first-order.ts` | Acquisition, Cohorts, LTV, Timings, First Product |
| `fetchAdSpendMapsWithClassification()` | `lib/metrics/ads-spend.ts` | Acquisition, Meta Ads, Google Ads |
| `buildGoalEvaluations()` | `lib/metrics/goals.ts` | Acquisition, Meta Ads, Google Ads |
| `getBuckets()` | `lib/pnl/buckets.ts` | P&L |
| `computeChurnThresholds()` | `lib/metrics/churn-thresholds.ts` | Customer Lifecycle |

---

## Prisma Models — Complete Usage Map

| Model | Pages |
|-------|-------|
| ShopifyOrder | P&L, Waterfall, Acquisition, Cohorts, LTV, Timings, Distributions, Products, RTO, Pincode, Calendar, Lifecycle, First Product, Store |
| ShopifyLineItem | P&L, Waterfall, Acquisition, Cohorts, LTV, Timings, Distributions, Products, RTO, Pincode, Calendar, First Product |
| ShopifyCustomer | Acquisition, Cohorts, LTV, Timings, Lifecycle, First Product, Store |
| ShopifyProduct / Variant | Products, Inventory, Store |
| ShopifyInventoryLevel | Inventory |
| ShopifyDailyAggregate | P&L, Waterfall, Acquisition, Calendar |
| ShopifyReturn | Products |
| metaAdDaily | P&L, Waterfall, Acquisition, Meta Ads |
| googleAdDaily | P&L, Waterfall, Acquisition, Google Ads |
| shiprocketShipment | P&L, Waterfall, Acquisition, Cohorts, LTV, Logistics, RTO, Pincode, COD-Prepaid |
| shiprocketOrder | Logistics, RTO, COD-Prepaid |
| workspaceCost | P&L, Waterfall, Acquisition, Cohorts, LTV |
| workspaceMiscExpense | Cohorts |
| workspaceFestival | Calendar |
| MarketingAction | Calendar |
| EmailPerformance | Email-SMS |
| WorkspaceAiInsightsCache | Legacy — do not use, replaced by ai_insights table |
