# Ads metrics: revenue flow, ROAS types, contribution margin, return rate, product multiple

## Current state (Google Ads + Meta Ads)

- **Stored:** Daily metrics per campaign (and ad set for Meta): spend, impressions, clicks, conversions, conversion_value (Google) / revenue (Meta).
- **Computed in API:** Single ROAS = conversion value (or revenue) / spend; totals and by-campaign/by-adset aggregation in memory.
- **Not implemented:** Revenue flow, multiple ROAS types, contribution margin, return rate, product multiple, materialized views, or dedicated aggregation tables.

---

## 1. Revenue flow

**Goal:** Track flow from ad spend → attributed revenue (platform) → actual order revenue (Shopify), optionally by channel/campaign.

**Needed:**

- **Attributed revenue:** Already in `google_ads_daily_metrics.conversion_value` and `meta_ads_daily_metrics.revenue`.
- **Order revenue:** `ShopifyOrder.totalPrice` (and possibly refunds if we add returns).
- **Attribution link (optional):** Either use platform attribution as-is, or store a mapping (e.g. order → UTM/source) to join orders to campaigns. That may require storing attribution at order creation (e.g. in Shopify order metadata or a separate `order_attribution` table).

**Implementation:**

- Add an **aggregation table** (or materialized view) by workspace + date range:  
  `ads_revenue_flow_daily` (or similar) with:  
  `workspace_id`, `source` (google | meta), `date`, `ad_spend`, `attributed_revenue`, `order_revenue` (from Shopify in same period, or attributed if we have the link).
- Optionally: `order_attribution` table (order_id, campaign_id, source, attributed_value) populated when orders are created/synced.

---

## 2. ROAS types

**Goal:** Support multiple ROAS definitions (attributed, blended, view-through, by window).

**Possible types:**

- **Attributed ROAS:** Current one: attributed conversion value / spend (already in use).
- **Blended ROAS:** Total order revenue in period / total ad spend (needs order revenue by period).
- **ROAS by attribution window:** Same formula but only conversions within 1-day, 7-day, 30-day click (would require storing conversion timestamps and window in sync or in aggregation).

**Implementation:**

- Keep computing **attributed ROAS** from existing daily metrics.
- Add **blended ROAS** in aggregation:  
  `blended_roas = (sum of order revenue in range) / (sum of ad spend in range)` using Shopify orders and ads daily tables.
- If you need windowed ROAS, extend sync or aggregation to store/aggregate by window (e.g. extra columns or a separate aggregation table by window).

---

## 3. Contribution margin

**Goal:** Profit after variable costs (e.g. COGS, fulfillment, payment) per order or per ad spend.

**Formula (conceptually):**  
`Contribution margin = Revenue − COGS − variable_costs`  
Then margin % or margin per rupee of spend.

**Needed:**

- **COGS:** Not in current schema. Options:  
  - Add `cost_per_item` (or COGS) to `ShopifyLineItem` or to `ShopifyProduct`, or  
  - Import from an external feed.
- **Variable costs (optional):** Payment %, fulfillment per order, etc. (new fields or tables).
- **Returns:** See “Return rate” below; refunds reduce revenue and affect margin.

**Implementation:**

- Add to schema, e.g.:  
  - `ShopifyLineItem.cogs` or `ShopifyProduct.defaultCogs`, and/or  
  - `ShopifyOrder.variable_costs` (or breakdown table).
- In aggregation (or materialized view):  
  - Sum `revenue - cogs - variable_costs` for orders in range.  
  - Optionally: `contribution_margin = (order_margin / ad_spend)` and surface in the same APIs used by Google/Meta Ads pages.

---

## 4. Return rate

**Goal:** % of orders (or revenue) returned, overall or by product/campaign.

**Needed:**

- **Returns/refunds data:** Not in schema. Options:  
  - Shopify Refunds API → new table `ShopifyRefund` / `ShopifyReturn` (order_id, amount, line_items, etc.).  
  - Or a simpler `order_returns` table: order_id, returned_amount, date.

**Implementation:**

- New table(s) for returns/refunds; sync from Shopify (or manual upload).
- Aggregation:  
  `return_rate = returned_amount / order_revenue` (or count of returned orders / total orders) by period, optionally by product or by attributed campaign if we have order attribution.

---

## 5. Product multiple

**Goal:** Product-level or “multiple” metrics, e.g. product ROAS, AOV multiple (revenue per order vs baseline), or product mix contribution.

**Needed:**

- **Product-level attribution:** Which products were in orders attributed to which campaign (e.g. from line items + order attribution).
- **AOV / baseline:** From `ShopifyOrder` (average order value); “multiple” = attributed AOV / baseline AOV or similar.

**Implementation:**

- Use `ShopifyLineItem` + `ShopifyOrder` + (optional) order attribution to get revenue and quantity by product.
- Join to ads data by time window (or by attribution) to get spend per product/campaign.
- Aggregation table or materialized view: e.g. `ads_product_performance` (workspace_id, campaign_id, product_id, spend, revenue, units, roas, aov_multiple).
- Surface in UI as a “Product multiple” or “Product ROAS” section on the same Google/Meta Ads pages (or a shared “Ads performance” view).

---

## 6. Materialized views vs aggregation tables

**Materialized views (Postgres):**

- **Pros:** No app code to maintain aggregations; refresh on schedule (cron) or after sync.  
- **Cons:** Prisma doesn’t manage them; use raw SQL migrations; need a refresh strategy (e.g. `REFRESH MATERIALIZED VIEW CONCURRENTLY`).

**Aggregation tables (normal Prisma tables):**

- **Pros:** Prisma-friendly, easy to query and extend; can update incrementally (e.g. on sync).  
- **Cons:** Refresh logic lives in app (or a job).

**Suggested approach:**

- Add **aggregation tables** (e.g. `ads_workspace_daily_summary`, `ads_campaign_summary`, `ads_product_performance`) filled by a **scheduled job or post-sync job** that:
  - Reads from `google_ads_daily_metrics`, `meta_ads_daily_metrics`, `ShopifyOrder`, line items, (and later returns, COGS).
  - Writes pre-aggregated rows (by workspace, date, campaign, product, etc.).
- Optionally, replace or back the “heavy” parts of these tables with **materialized views** in Postgres and refresh them in the same job (e.g. nightly or after sync).

---

## 7. Where to expose (Google Ads + Meta Ads pages)

- **Revenue flow:** Summary card or small section: “Attributed revenue vs order revenue” (and blended ROAS if implemented).
- **ROAS types:** Summary cards or a dropdown: “Attributed ROAS” (current), “Blended ROAS”; table columns can show the same.
- **Contribution margin:** Once COGS/variable costs exist: “Contribution margin” and “Margin %” (and per-campaign if we have attribution).
- **Return rate:** Summary and, if needed, by product or campaign.
- **Product multiple:** A “By product” or “Product ROAS” table/section on the same pages or a shared “Ads performance” page.

All of these can keep using the same **page components** (`GoogleAdsContent`, `MetaAdsContent`); add new API routes or extend existing `/api/workspaces/[slug]/google-ads/metrics` and `/api/workspaces/[slug]/meta-ads/metrics` (or a shared `/api/workspaces/[slug]/ads-performance`) that read from the new aggregation tables (or materialized views) and return the extra metrics.

---

## 8. Suggested order of implementation

1. **Aggregation tables + job:** e.g. `ads_workspace_daily_summary` (workspace_id, date, source, spend, attributed_revenue, order_revenue, attributed_roas, blended_roas). Populate from existing daily metrics + Shopify orders by date. No new ad sync logic.
2. **Blended ROAS + revenue flow (high level):** Use the summary table to show “Attributed vs order revenue” and “Blended ROAS” on Google/Meta Ads pages.
3. **Return rate:** Add returns/refunds schema + sync, then add to aggregation and UI.
4. **Contribution margin:** Add COGS/variable costs to schema and aggregation, then surface margin and margin %.
5. **Product multiple:** Add product-level aggregation (and optional order attribution), then “Product ROAS” / “Product multiple” in UI.
6. **Materialized views (optional):** If some aggregations become heavy, replace or mirror them with materialized views and refresh in the same job.

This keeps the existing Google Ads and Meta Ads pages as the main surface and extends them with revenue flow, ROAS types, contribution margin, return rate, and product multiple, using aggregation queries (and optionally materialized views) as the implementation backbone.
