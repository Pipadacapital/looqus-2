# CLAUDE.md — Shopify Analytics Project Guidelines

## What This Project Is
Multi-workspace ecommerce analytics SaaS for Shopify brands. Each workspace connects to Shopify, Meta Ads, Google Ads, Shiprocket, and Klaviyo. The platform calculates P&L, cohorts, LTV, acquisition, logistics, and ad performance metrics.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| React | React 19 |
| Database | PostgreSQL via Prisma 5 |
| Auth | Supabase SSR (`@supabase/ssr`) |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui, Radix UI, Base UI |
| Icons | Tabler Icons (`@tabler/icons-react`), Lucide React |
| Charts | Recharts |
| Tables | TanStack Table v8 |
| Data Fetching | TanStack Query v5 (client), Next.js fetch (server) |
| Forms | react-hook-form + zod v4 |
| Toasts | Sonner |
| Carousel | Embla Carousel |
| Markdown | react-markdown + remark-gfm |

---

## Project Structure

```
app/
├── (protected)/w/[slug]/     ← All analytics pages (one folder per page)
│   ├── dashboard/
│   ├── analytics/
│   ├── pnl/
│   ├── waterfall/
│   ├── acquisition/
│   ├── cohorts/
│   ├── lifetime-value/
│   ├── timings/
│   ├── distributions/
│   ├── customer-lifecycle/
│   ├── first-product-cascade/
│   ├── meta-ads/
│   ├── google-ads/
│   ├── products/
│   ├── inventory/
│   ├── logistics/
│   ├── rto-analytics/
│   ├── pincode-intelligence/
│   ├── cod-prepaid/
│   ├── calendar/
│   ├── email-sms/
│   └── store/
├── api/
│   ├── workspaces/[slug]/    ← All workspace API routes
│   ├── integrations/         ← OAuth + sync routes (Meta, Google, Shiprocket, Klaviyo)
│   ├── shopify/              ← Shopify webhook + connect routes
│   ├── cron/                 ← Scheduled sync jobs
│   └── admin/                ← Admin-only sync triggers
lib/
├── metrics/                  ← Core analytics calculation functions
├── cogs/                     ← Cost of goods sold resolution
├── pnl/                      ← P&L bucketing utilities
├── acquisition/              ← New customer acquisition calculations
├── cohorts/                  ← Cohort analysis engine
├── ltv/                      ← Lifetime value calculations
├── timings/                  ← Repurchase timing analysis
├── distributions/            ← Distribution/histogram analysis
├── products/                 ← Product profitability
├── workspace-metrics/        ← Shiprocket: logistics, RTO, COD/prepaid, pincode
├── email-performance/        ← Klaviyo email/SMS metrics
├── festivals/                ← Indian festival calendar
├── integrations/             ← Meta, Google, Klaviyo, Shiprocket sync logic
├── shopify/                  ← Shopify API client + bulk operations + sync
├── ai-calc/                  ← OLD AI data prep — DO NOT USE OR MODIFY
├── insights/                 ← OLD insight logic — DO NOT USE OR MODIFY
├── effective-daily.ts        ← Daily aggregates with analytics/order fallback
├── order-filters.ts          ← Order tag filtering + Prisma WHERE builders
├── workspace-costs.ts        ← Variable cost daily allocation
├── prisma.ts                 ← Prisma client singleton
├── client.ts                 ← Supabase browser client
└── server.ts                 ← Supabase server client
module/
├── ai/                       ← OLD AI module — DO NOT USE OR MODIFY
└── ai-engine/                ← NEW AI insight engine (build here)
prisma/
└── schema.prisma             ← Single source of truth for DB schema
```

---

## Running the Project

```bash
npm run dev           # Start dev server at localhost:3000
npm run build         # Production build
npm run db:push       # Push schema changes to DB (no migration file)
npm run db:migrate    # Create + apply a named migration
npm run db:generate   # Regenerate Prisma client after schema changes
npm run db:studio     # Open Prisma Studio in browser
```

---

## Database Rules

- **Prisma is the only DB access method** — never use raw SQL unless absolutely required
- **Never query `workspace_daily_metrics`** — this table is empty and unused
- All date ranges use **UTC boundaries** (`T00:00:00.000Z` to `T23:59:59.999Z`)
- Workspace membership must be validated on every API route before returning data
- `lib/prisma.ts` exports the singleton Prisma client — always import from there

### Key Prisma Models

| Model | Purpose |
|-------|---------|
| `Workspace` | Core workspace (slug, plan, settings, timezone) |
| `WorkspaceMember` | User ↔ Workspace membership + roles |
| `ShopifyConnection` | Shopify integration status + last sync |
| `ShopifyOrder` | Order headers |
| `ShopifyLineItem` | Order line items (product, variant, qty, price) |
| `ShopifyCustomer` | Customer records |
| `ShopifyProduct` / `ShopifyProductVariant` | Product catalog |
| `ShopifyDailyAggregate` | Cached daily order/revenue aggregates |
| `ShopifyInventoryLevel` | Current stock levels |
| `metaAdDaily` | Meta daily spend/impressions/conversions |
| `googleAdDaily` | Google daily spend/impressions/conversions |
| `shiprocketShipment` | Shipment records (status, courier, charges) |
| `WorkspaceCost` | Fixed costs (shipping, packaging, website) |
| `WorkspaceCogsSettings` | COGS configuration |
| `WorkspaceMiscExpense` | Misc expense line items |
| `WorkspaceAiInsightsCache` | Existing AI cache model (for reference only) |
| `EmailPerformance` | Klaviyo email/SMS metrics |

---

## API Route Conventions

- Every route validates Supabase auth + workspace membership before doing anything
- Routes live at `app/api/workspaces/[slug]/[feature]/route.ts`
- Use `NextResponse.json()` for responses
- All errors return `{ error: string }` with appropriate HTTP status

---

## Key Shared Lib Functions (Reuse These — Never Rewrite)

| Function | File | What It Does |
|----------|------|-------------|
| `getEffectiveDailyAggregates()` | `lib/effective-daily.ts` | Daily aggregates (analytics cache → order fallback) |
| `getOrderInclusionWhere()` | `lib/order-filters.ts` | Prisma WHERE from workspace order filter settings |
| `getFilteredDailyAggregates()` | `lib/order-filters.ts` | Applies workspace filters to daily aggregates |
| `getDailyVariableContribution()` | `lib/workspace-costs.ts` | Daily variable cost allocation (shipping, packaging, etc.) |
| `normalizeCogsSettings()` | `lib/cogs/index.ts` | Parse workspace COGS settings |
| `resolveLineItemCogs()` | `lib/cogs/resolve.ts` | COGS per line item |
| `computeLineItemsCogs()` | `lib/cogs/resolve.ts` | COGS for a set of line items |
| `totalChargesFromRaw()` | `lib/shiprocket-charges.ts` | Shiprocket charge breakdown |
| `getLogisticsSummary()` | `lib/workspace-metrics/logistics-summary.ts` | Shiprocket operational summary |
| `fetchCustomerFirstOrdersInRange()` | `lib/metrics/customer-first-order.ts` | Identify first-time buyers |
| `fetchAdSpendMapsWithClassification()` | `lib/metrics/ads-spend.ts` | Ad spend by campaign intent |
| `getBuckets()` | `lib/pnl/buckets.ts` | Time buckets (day/week/month/quarter) |

---

## UI Conventions

- Use **shadcn/ui** components as the base — install via `npx shadcn add [component]`
- Icons: prefer **Tabler Icons** (`@tabler/icons-react`) over Lucide for new code
- Toasts: always use **Sonner** (`import { toast } from "sonner"`)
- Forms: always use **react-hook-form** + **zod** for validation
- Data tables: use **TanStack Table** for sortable/filterable tables
- Charts: use **Recharts**
- Loading states: use skeleton components, never spinners alone
- All monetary values display in workspace currency (default INR)

---

## AI Insight Engine — The Most Important Section

### Golden Rules
1. **All new AI code goes in `module/ai-engine/`** — never anywhere else
2. **Never touch `module/ai/`** — old, legacy, abandoned
3. **Never touch `lib/ai-calc/`** — old AI data prep, abandoned
4. **Never touch `lib/insights/`** — old insight logic, abandoned
5. **Build from scratch** — do not copy or adapt anything from old modules

### Primary AI Provider
- **Claude API** via `@anthropic-ai/sdk`
- Secondary: OpenAI (`openai` SDK), Ollama (local)
- No LangChain, no LlamaIndex, no external orchestration frameworks
- Direct SDK calls only

### module/ai-engine/ Structure
```
module/ai-engine/
├── providers/
│   ├── types.ts              # Unified provider interface + capability flags
│   ├── claude.ts             # @anthropic-ai/sdk wrapper
│   ├── openai.ts             # openai SDK wrapper
│   ├── ollama.ts             # Ollama local wrapper
│   └── router.ts             # Provider selection + fallback chain
├── config/
│   └── workspace-ai-config.ts  # Read/write workspace AI provider settings
├── context-adapters/         # One file per page — thin wrappers over lib/ functions
│   ├── types.ts              # PageContext, InsightContext types
│   ├── pnl.ts
│   ├── acquisition.ts
│   ├── cohorts.ts
│   ├── ... (one per analytics page)
│   └── global.ts             # Combines adapters for cross-page insight
├── analysis/                 # Pure math — no AI, no DB
│   ├── comparator.ts         # Period-over-period % change
│   ├── anomaly.ts            # Z-score / IQR anomaly detection
│   └── trend.ts              # Trend direction + velocity
├── prompts/
│   ├── system.ts             # Base system prompt
│   └── page/                 # Per-page prompt templates
│       ├── pnl.ts
│       ├── acquisition.ts
│       └── ... (one per page)
├── pipeline/
│   ├── page-insight.ts       # adapter → analysis → prompt → AI → insight
│   ├── global-insight.ts     # all adapters → AI → cross-page insight
│   └── chat.ts               # Streaming chat with context
├── cache/
│   └── insight-cache.ts      # DB-backed cache (ai_insights table)
├── types.ts                  # All shared types
└── index.ts                  # Public API surface
```

### Data Strategy
- **Never send raw DB rows to AI** — only pre-computed metric summaries
- **Hard limit: ~2,000 tokens of context per insight** — be ruthless about compression
- **Context adapters call existing `lib/` functions** — zero calculation duplication
- **Always auto-compare current vs prior period** before building the prompt
- **Always save generated insights to the `ai_insights` DB table** (future RAG prep)

### Insight Generation Strategy
- **Smart on-demand with caching** — NOT a daily cron, NOT on every page load
- Cache key: `hash(workspaceId + page + dateFrom + dateTo + filters)`
- Cache TTL: 6 hours default
- On page load: serve cached insight immediately (even if stale), regenerate in background
- Invalidate cache on: data sync, date range change, manual refresh, provider change
- Always stream responses — never make the user wait for a full response

### Build Order
1. `module/ai-engine/providers/` — Claude + router (foundation)
2. `module/ai-engine/config/` — AI switcher + workspace settings
3. DB table: `ai_insights` — save everything from day 1
4. `module/ai-engine/analysis/` — pure math layer
5. `module/ai-engine/context-adapters/` — starting with analytics page
6. `module/ai-engine/prompts/` — per-page prompt templates
7. `module/ai-engine/pipeline/` + API routes — orchestration + streaming
8. UI — insight panel component (one, reused across all pages)
9. Pages: analytics → pnl → cohorts → ... → global dashboard

### RAG — Later
- Skip RAG for now — no pgvector, no embeddings yet
- When ready: add `embedding vector(1536)` to `ai_insights` table + backfill
- Embedding model: OpenAI `text-embedding-3-small` (if key exists) or Ollama `nomic-embed-text` (free)
- Never Pinecone — pgvector on existing Postgres is sufficient

### What Makes Insights Powerful
- Always compare to prior period (auto)
- Detect anomalies statistically before prompting AI
- AI reasons about PRE-ANALYZED data, not raw numbers
- Per-page prompts that understand the specific metrics of that page
- Specific, actionable recommendations — never just describing numbers

---

## What Never To Do

- Never use `workspace_daily_metrics` — empty, unused
- Never modify `module/ai/` — dead code
- Never modify `lib/ai-calc/` — dead code
- Never modify `lib/insights/` — dead code
- Never use LangChain or any orchestration framework
- Never use Pinecone — use pgvector when needed
- Never send raw Prisma rows to AI
- Never duplicate calculation logic — always call existing `lib/` functions
- Never skip workspace membership validation in API routes
- Never use `console.log` in production code — use proper error handling
- Never hardcode workspace IDs or slugs
- Never bypass Supabase auth

---

## Full Page ↔ API Route Map

| Page | API Route |
|------|-----------|
| `/pnl` | `/api/workspaces/[slug]/pnl` |
| `/waterfall` | `/api/workspaces/[slug]/waterfall` |
| `/acquisition` | `/api/workspaces/[slug]/acquisition` |
| `/cohorts` | `/api/workspaces/[slug]/cohorts` |
| `/lifetime-value` | `/api/workspaces/[slug]/lifetime-value` |
| `/timings` | `/api/workspaces/[slug]/timings` |
| `/distributions` | `/api/workspaces/[slug]/distributions` |
| `/customer-lifecycle` | `/api/workspaces/[slug]/customer-lifecycle` |
| `/first-product-cascade` | `/api/workspaces/[slug]/first-product-cascade` |
| `/meta-ads` | `/api/workspaces/[slug]/meta-ads/metrics` + `/creative` |
| `/google-ads` | `/api/workspaces/[slug]/google-ads/metrics` |
| `/products` | `/api/workspaces/[slug]/products` |
| `/inventory` | `/api/workspaces/[slug]/inventory` |
| `/logistics` | `/api/workspaces/[slug]/logistics` |
| `/rto-analytics` | `/api/workspaces/[slug]/rto-analytics` |
| `/pincode-intelligence` | `/api/workspaces/[slug]/pincode-intelligence` |
| `/cod-prepaid` | `/api/workspaces/[slug]/cod-prepaid-analytics` |
| `/calendar` | `/api/workspaces/[slug]/calendar-report` |
| `/email-sms` | `/api/workspaces/[slug]/email-sms-report` |
| `/store` | `/api/workspaces/[slug]/store/orders\|products\|customers` |

---

## New AI Engine API Routes (to be created)

```
app/api/workspaces/[slug]/ai-engine/
├── insights/route.ts     # GET ?page=pnl&from=...&to=...  (streaming)
├── global/route.ts       # GET ?from=...&to=...           (streaming)
├── chat/route.ts         # POST with messages array        (streaming)
└── config/route.ts       # GET + PATCH provider settings
```
