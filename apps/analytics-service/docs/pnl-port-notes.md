# /pnl port notes

Reference for porting Looqus TS `/pnl` route to Python (Phase 5 SP-1).
Source: `apps/frontend/app/api/workspaces/[slug]/pnl/route.ts`
Target: `apps/analytics-service/src/queries/pnl.py` + `src/lib/*.py`

---

## 1. Request shape

| Param | Type | Default | Validation |
|-------|------|---------|------------|
| `slug` | path string | required | workspace lookup (404 if not found) |
| `from` | query string `yyyy-MM-dd` | today − 364 days | parsed as `${from}T00:00:00.000Z`; 400 if invalid or `from > to` |
| `to` | query string `yyyy-MM-dd` | today | parsed as `${to}T23:59:59.999Z`; 400 if invalid |
| `granularity` | query string enum | `"day"` | one of `day | week | month | quarter`; silently falls back to `day` |

**Slug → workspace lookup:**
```
prisma.workspace.findUnique({ where: { slug } })
```
Includes: `shopifyConnections` (CONNECTED only, id only, take:1), `woocommerceConnection` (id, status, currency, storeUrl, consumerKey, consumerSecret), `cogsSettings`, `meta_ads_connections` (id, selected_ad_account_ids, selected_ad_account_id), `google_ads_connections` (id, selected_customer_ids, selected_customer_id), `shiprocketConnection` (id, status).

Also reads: `workspace.features`, `workspace.platform`, `workspace.founder_salary_monthly`, `workspace.founder_salary_currency`, `workspace.skipped_shopify_order_tags`, `workspace.skip_zero_sales_orders`.

---

## 2. Auth + featureGuard

These gates run in the Next.js proxy layer (Task 13) and are **not** re-implemented in Python.

1. **Supabase auth** — `supabase.auth.getUser()` → 401 if no user.
2. **Workspace membership** — `prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } })` → 403 if not found.
3. **featureGuard** — `featureGuard(workspace.features, 'pnl')` — returns a redirect/error response if the workspace plan does not include `pnl`. Implementation: `lib/features.ts` (not ported to Python).
4. **Connection check** — if Shopify workspace has no CONNECTED `shopifyConnection`, or WooCommerce workspace has no CONNECTED `woocommerceConnection`, returns `{ rows: [], currency: 'USD' }` (200, empty). Python should propagate this as an empty result.

---

## 3. Workspace settings reads

All fetched in the initial `prisma.workspace.findUnique` (§1 include block). No additional Prisma calls between auth and the `Promise.all`.

| Field | Source | Used for |
|-------|--------|----------|
| `workspace.platform` | `Workspace.platform` enum | Branch: `isWoocommerce = platform === 'WOOCOMMERCE'` |
| `workspace.shopifyConnections[0].id` | `ShopifyConnection` | `effectiveConnectionId` for all Shopify queries |
| `workspace.woocommerceConnection` | `WoocommerceConnection` | `woocommerceConnectionId`, store currency for Woo |
| `workspace.cogsSettings` | `WorkspaceCogsSettings` | Passed to `normalizeCogsSettings()` → COGS resolution |
| `workspace.meta_ads_connections` | `MetaAdsConnection` | ad account filter for Meta spend query |
| `workspace.google_ads_connections` | `GoogleAdsConnection` | customer filter for Google spend query |
| `workspace.shiprocketConnection` | `ShiprocketConnection` | gating the shipments query (CONNECTED check) |
| `workspace.founder_salary_monthly` | `Workspace` Decimal? | Monthly founder salary to prorate per bucket |
| `workspace.founder_salary_currency` | `Workspace` string? | Currency of founder salary (default `'INR'`) |
| `workspace.skipped_shopify_order_tags` / `workspace.skip_zero_sales_orders` | `Workspace` | Passed to `normalizeOrderFilterSettings()` → order filter WHERE |

**Pre-Promise.all side-effect (WooCommerce only):** `ensureWooOrderTypesForOrderFilters(woocommerceConnectionId, orderFilterSettings, { maxUpdates: 5000 })` — this **writes back** `order_type` to WooCommerce order rows in the DB before the main data fetch. **OUT OF SCOPE for SP-1** (Shopify fixture only).

---

## 4. The parallel Promise.all

Ten slots. For Shopify (SP-1 scope), WooCommerce branches resolve to `[]` or equivalent.

### 4.1 `dailyAnalytics`
- **Model:** `ShopifyAnalyticsDaily` (table: `shopify_analytics_daily`)
- **WHERE:** `connectionId = effectiveConnectionId AND date >= fromDate AND date <= toDate`
- **ORDER BY:** `date ASC`
- **Selected fields:** `date, netSales, grossSales, totalTax, totalDiscount, ordersCount, currency, total_returns, returns`
- **Used in §5:** Primary daily source for `grossSales`, `discounts`, `ordersCount`, `refunds`, `productRefunds`, `shippingRefunds`. Merged with order-derived rows for dates missing from analytics (fallback logic, see §8).

### 4.2 `workspaceCosts`
- **Model:** `WorkspaceCost`
- **WHERE:** `workspaceId = workspace.id AND effectiveFrom <= toDate`
- **No ORDER BY**
- **All fields selected** (full row)
- **Used in §5:** `variableCosts` — one cost entry per day via `getDailyVariableContribution()`. Fields used: `costType, amount, currency, isPercent, billingMode, effectiveFrom, effectiveTo`.

### 4.3 `miscExpenses`
- **Model:** `WorkspaceMiscExpense`
- **WHERE:** `workspaceId = workspace.id AND effectiveStartDate <= toDate`
- **All fields selected**
- **Used in §5:** `fixedCosts` — each active expense contributes `amount / daysInMonth` per day, currency-converted to `storeCurrency`.

### 4.4 `products`
- **Model:** `ShopifyProduct` (Shopify path)
- **WHERE:** `connectionId = effectiveConnectionId`
- **Selected fields:** `shopifyId, coq`
- **Used in §5:** Builds `coqMap: Map<shopifyId, coq>` → passed to `computeLineItemsCogs()` for COGS resolution.

### 4.5 `lineItemsInRange`
- **Model:** `ShopifyLineItem`
- **WHERE:** `connectionId = effectiveConnectionId AND order.connectionId = effectiveConnectionId AND order.processedAt >= fromDate AND order.processedAt <= toDate AND <orderInclusionWhere>`
- **Selected fields:** `productShopifyId, quantity, price, order { id, processedAt }`
- **Used in §5:** Input to `computeLineItemsCogs()` → produces `dailyCogs` map.

### 4.6 `metaAdDaily`
- **Model:** `meta_ads_daily_metrics`
- **WHERE:** `connection_id = meta_ads_connections.id AND date >= fromDate AND date <= toDate`; optionally filtered by `ad_account_id IN selected_ad_account_ids` or `= selected_ad_account_id`
- **Selected fields:** `date, spend`
- **Used in §5:** `metaAdSpend` and `adSpend` (summed into daily maps).

### 4.7 `googleAdDaily`
- **Model:** `google_ads_daily_metrics`
- **WHERE:** `connection_id = google_ads_connections.id AND date >= fromDate AND date <= toDate`; optionally filtered by `customer_id IN selected_customer_ids` or `= selected_customer_id`
- **Selected fields:** `date, spend`
- **Used in §5:** `googleAdSpend` and `adSpend` (summed into daily maps).

### 4.8 `shiprocketShipments`
- **Model:** `ShiprocketShipment`
- **WHERE:** `connectionId = shiprocketConnection.id` (no date filter — full history)
- **Selected fields:** `shippedAt, shiprocketCreatedAt, rawJson`
- **Used in §5:** `shippingCosts` — builds `monthPrevAvg` map (previous month's avg charge × current bucket order count).

### 4.9 `allOrdersInRange`
- **Model:** `ShopifyOrder`
- **WHERE:** `connectionId = effectiveConnectionId AND processedAt >= fromDate AND processedAt <= toDate AND <orderInclusionWhere>`
- **Selected fields:** `id, customerShopifyId, processedAt, totalPrice, totalTax, totalDiscount, currency`
- **Used in §5:** NC/EC revenue attribution (`ncNetRevenue`, `ecNetRevenue`), order-derived fallback rows for missing analytics dates, `ordersCount` cross-check.

### 4.10 `filteredDaily`
- **Condition:** only fetched when `hasNoOrderFilters(orderFilterSettings)` is false (workspace has tag/zero-sale filters). Otherwise resolves to `Map()`.
- **Implementation:** `getFilteredDailyAggregates(prisma, effectiveConnectionId, fromDate, toDate, orderFilterSettings)`
- **Result shape:** `Map<dateStr, { grossSales: number; ordersCount: number }>`
- **Used in §5:** Overrides `grossSales` and `ordersCount` from analytics for filtered workspaces.

---

## 5. Per-bucket math (the 36 PnLRow fields)

For each bucket, the route iterates `getBucketUtcDateStrings(bucket)` — every UTC calendar day in the bucket — accumulating totals, then computes derived fields.

**Source priority for grossSales / ordersCount per day:**
- If `filteredDaily.get(dateStr)` exists → use filtered row (grossSales, ordersCount).
- Else if `effectiveDaily` has a row for that date → use analytics/order-derived row.
- `totalDiscount` and `totalTax` always come from `effectiveDaily` (never from `filteredDaily`).

### Field formulas

- **`grossSales` / `sales` / `productGross`:** Both set to the same value — sum of `grossSales` from `filteredDaily` or `effectiveDaily` per day in bucket, currency already in `storeCurrency`.

- **`discounts` / `productDiscount`:** Sum of `totalDiscount` from `effectiveDaily` per day. Sign may be negative (as stored); `discountsAmount = Math.abs(discounts)`.

- **`shippingGross` / `shippingDiscount` / `shippingNet` / `returnFees` / `returnsCosts` / `paymentCosts` / `customsCosts` / `otherVariable`:** Always `0` in current implementation — reserved for future use.

- **`netSales` / `productNet`:** `grossSales - Math.abs(discounts)`

- **`refunds`:** Sum of `total_returns` from `effectiveDaily` per day in bucket.

- **`productRefunds`:** Sum of `returns` from `effectiveDaily` per day in bucket.

- **`shippingRefunds`:** `refunds - productRefunds` (i.e. `total_returns - returns`).

- **`revenue`:** `grossSales - Math.abs(refunds)`

- **`netRevenue`:** `revenue - Math.abs(totalTax)`

- **`ncNetRevenue`:** Revenue attributed to new customers (first order in range) — `totalPrice - totalTax` per NC order, summed into bucket. Computed from `allOrdersInRange` before bucket loop: for each customer the earliest order date in range is their NC order.

- **`ecNetRevenue`:** Same calculation for existing customers (non-first orders).

- **`cogs`:** Sum of `dailyCogs.get(dateStr)` per day — output of `computeLineItemsCogs()` over `lineItemsInRange`.

- **`variableCosts`:** Per day, sum over all active `workspaceCosts` (those where `effectiveFrom <= dateStr <= effectiveTo`) of `getDailyVariableContribution(cost, dateStr, dayOrders, dayGross, storeCurrency)`. See §6 for formula details by `costType`.

- **`shippingCosts`:** `monthPrevAvg.get(bucket.start.slice(0,7)) * ordersCount` — previous full month's average Shiprocket charge per order × bucket order count.

- **`adSpend`:** Sum of `dailyAdSpend.get(dateStr)` = Meta + Google combined.

- **`metaAdSpend`:** Sum of `dailyMetaAdSpend.get(dateStr)`.

- **`googleAdSpend`:** Sum of `dailyGoogleAdSpend.get(dateStr)`.

- **`contributionMargin1` (CM1):** `netSales - cogs - variableCosts`

- **`contributionMargin2` (CM2):** `CM1 - adSpend`

- **`fixedCosts`:** Per day per active misc expense: `convertCurrency(expense.amount, expense.currency, storeCurrency) / daysInMonth(day)`. Summed across all days × all expenses in bucket.

- **`contributionMargin3` (CM3):** `CM2 - fixedCosts`

- **`founderSalaryAllocated`:** `allocateMonthlyToBucket(convertCurrency(founderMonthly, founderCurrency, storeCurrency), bucket, fromDate, toDate)` — prorate monthly amount by overlap days / days-in-month.

- **`netProfit`:** `CM3 - founderSalaryAllocated`

- **`ordersCount`:** Sum of `ordersCount` from `filteredDaily` or `effectiveDaily` per day in bucket.

- **`bucketKey`:** String key — `yyyy-MM-dd` (day), `yyyy-Www` (week), `yyyy-MM` (month), `yyyy-Qq` (quarter).

- **`label`:** Human-readable string — e.g. `"May 14, 2026"` / `"Week 20, 2026"` / `"May 2026"` / `"Q2 2026"`. All formatted in UTC.

---

## 6. Helper function map (TS → Python)

| TS file:function | Python target | Notes |
|------------------|---------------|-------|
| `route.ts: EXCHANGE_RATES` | `src/lib/currency.py: EXCHANGE_RATES` | Verbatim port — dict of 6 currencies vs USD |
| `route.ts: convertCurrency()` | `src/lib/currency.py: convert_currency()` | Same logic; fallback rate = 1.0 |
| `lib/pnl/buckets.ts: getBuckets()` | `src/lib/buckets.py: get_buckets()` | All UTC; returns sorted latest→oldest. Week = ISO Monday-start. |
| `lib/pnl/buckets.ts: getBucketUtcDateStrings()` | `src/lib/buckets.py: get_bucket_utc_date_strings()` | Iterate UTC days in [start, end] |
| `lib/pnl/buckets.ts: allocateMonthlyToBucket()` | `src/lib/buckets.py: allocate_monthly_to_bucket()` | Overlap-days / days-in-month × monthly amount |
| `lib/order-filters.ts: normalizeOrderFilterSettings()` | `src/lib/order_filters.py: normalize_order_filter_settings()` | Reads camelCase or snake_case workspace fields |
| `lib/order-filters.ts: hasNoOrderFilters()` | `src/lib/order_filters.py: has_no_order_filters()` | True if no tags and not skipZero |
| `lib/order-filters.ts: getOrderInclusionWhereFromWorkspace()` | `src/lib/order_filters.py: get_order_inclusion_where()` | Returns SQLAlchemy/dict WHERE fragment |
| `lib/order-filters.ts: getFilteredDailyAggregates()` | `src/queries/pnl.py` (inline) | Aggregates ShopifyOrder by day when filters active |
| `lib/order-filters.ts: resolveWoocommerceOrderType()` | **OUT OF SCOPE SP-1** | WooCommerce only |
| `lib/order-filters.ts: isWoocommerceOrderIncluded()` | **OUT OF SCOPE SP-1** | WooCommerce only |
| `lib/integrations/woocommerce-sync.ts: ensureWooOrderTypesForOrderFilters()` | **OUT OF SCOPE SP-1** | WooCommerce only; writes to DB |
| `lib/integrations/woocommerce-sync.ts: fetchLiveWoocommerceOrderTypeMap()` | **OUT OF SCOPE SP-1** | WooCommerce only; live API call |
| `lib/cogs/resolve.ts: normalizeCogsSettings()` | `src/lib/cogs.py: normalize_cogs_settings()` | Coerces DB Decimals to floats |
| `lib/cogs/resolve.ts: resolveLineItemCogs()` | `src/lib/cogs.py: resolve_line_item_cogs()` | Override → coq → fallback → markup chain |
| `lib/cogs/resolve.ts: computeLineItemsCogs()` | `src/lib/cogs.py: compute_line_items_cogs()` | Returns `(total_cogs, daily_cogs: dict[str, float])` |
| `lib/workspace-costs.ts: getDailyVariableContribution()` | `src/lib/workspace_costs.py: get_daily_variable_contribution()` | SHIPPING/PACKAGING: monthly÷days or per_order×count; WEBSITE: %×gross or ×count; CUSTOM: ×count |
| `lib/shiprocket-charges.ts: totalChargesFromRaw()` | `src/lib/shiprocket_charges.py: total_charges_from_raw()` | JSON path traversal: fwd + rto + cod charges |
| `lib/shopify/store-currency.ts: getShopifyStoreCurrency()` | `src/lib/store_currency.py: get_shopify_store_currency()` | 4-priority lookup; returns string |
| `date-fns: getDaysInMonth()` | Python `calendar.monthrange()` | Used in fixed-cost daily allocation and `allocateMonthlyToBucket` |
| `date-fns: differenceInDays()` | Python `(d2 - d1).days` | Used in `allocateMonthlyToBucket` and quarter bucket sizing |

---

## 7. Response shape (parity contract)

The route returns:
```json
{ "rows": [PnLRow, ...], "currency": "INR" }
```

The proto `PnLResponse` must serialise via the Next.js proxy as camelCase JSON matching exactly. All 36 `PnLRow` fields are already camelCase in TS — proto field names should be `snake_case` internally and mapped to camelCase at the proxy boundary.

Fields where proto snake_case differs from JSON camelCase key:

| Proto field (snake_case) | JSON key (camelCase) |
|--------------------------|----------------------|
| `bucket_key` | `bucketKey` |
| `gross_sales` | `grossSales` |
| `net_sales` | `netSales` |
| `product_gross` | `productGross` |
| `shipping_gross` | `shippingGross` |
| `product_discount` | `productDiscount` |
| `shipping_discount` | `shippingDiscount` |
| `product_net` | `productNet` |
| `shipping_net` | `shippingNet` |
| `product_refunds` | `productRefunds` |
| `shipping_refunds` | `shippingRefunds` |
| `return_fees` | `returnFees` |
| `nc_net_revenue` | `ncNetRevenue` |
| `ec_net_revenue` | `ecNetRevenue` |
| `net_revenue` | `netRevenue` |
| `variable_costs` | `variableCosts` |
| `shipping_costs` | `shippingCosts` |
| `returns_costs` | `returnsCosts` |
| `payment_costs` | `paymentCosts` |
| `customs_costs` | `customsCosts` |
| `other_variable` | `otherVariable` |
| `ad_spend` | `adSpend` |
| `meta_ad_spend` | `metaAdSpend` |
| `google_ad_spend` | `googleAdSpend` |
| `contribution_margin1` | `contributionMargin1` |
| `contribution_margin2` | `contributionMargin2` |
| `contribution_margin3` | `contributionMargin3` |
| `fixed_costs` | `fixedCosts` |
| `founder_salary_allocated` | `founderSalaryAllocated` |
| `net_profit` | `netProfit` |
| `orders_count` | `ordersCount` |

Single-word fields (`label`, `discounts`, `sales`, `refunds`, `revenue`, `cogs`) map 1:1.

---

## 8. Gotchas

### TZ handling
All date boundaries are UTC: `fromDate = {fromStr}T00:00:00.000Z`, `toDate = {toStr}T23:59:59.999Z`. All date-key comparisons use `.toISOString().slice(0, 10)` (UTC calendar day). Bucket boundaries (`getBuckets`) are constructed with `Date.UTC(...)` throughout — no local timezone involved anywhere. Python: use `datetime(..., tzinfo=timezone.utc)` and format with `strftime('%Y-%m-%d')`.

### Decimal → float coercion
Prisma returns `Decimal` objects for monetary fields (`grossSales`, `netSales`, `totalTax`, `totalDiscount`, `total_returns`, `returns`, `amount`, `spend`, etc.). The route coerces with `Number(...)` before all arithmetic. Python: SQLAlchemy may return `Decimal` — coerce to `float()` at the query boundary, not in math functions.

### Analytics fallback (order-derived rows)
When `ShopifyAnalyticsDaily` has no row for a date that has orders (common for recent days before ShopifyQL catches up), the route synthesises a pseudo-analytics row from `allOrdersInRange` aggregated by day. The synthetic row sets `total_returns` and `returns` from WooCommerce refund fields only (Shopify orders don't carry per-order refund in the selected fields). For Shopify, `total_returns` and `returns` in synthetic rows are always 0. Python must replicate this merge: union of analytics rows + order-derived rows for dates not in analytics set, sorted by date.

### Buckets sorted latest → oldest
`getBuckets()` returns buckets **sorted descending** (newest first) — `buckets.sort((a,b) => b.end - a.end)`. The `rows` array in the response is therefore newest-first. The frontend relies on this ordering. Python must preserve it.

### `filteredDaily` override scope
When `filteredDaily` has a row for a date, it overrides `grossSales` and `ordersCount` only. `totalDiscount` and `totalTax` still come from `effectiveDaily` (analytics row) for that date — there is no filtered version of those fields. This asymmetry is intentional.

### Shiprocket shipping cost algorithm
Uses **previous month's** average charge, not current month. If the current bucket's month has no `prevMonth` entry in `monthPrevAvg`, `shippingCosts = 0`. The Shiprocket query has **no date filter** — it fetches all-time shipments and groups by `yyyy-mm` internally. This is intentional (need full history to compute prev-month avg for the earliest months in range).

### `ensureWooOrderTypesForOrderFilters` mutation
This function runs **before** the `Promise.all` and may write `order_type` back to `woocommerceOrder` rows. It is deferred from the parallel block specifically because it must complete before `allOrdersInRange` is fetched (so the freshly-written `orderType` column is readable). **SP-1 skip:** Shopify path never calls this.

### `isWoocommerce` branches
Eight places in the route branch on `isWoocommerce`. For SP-1 Python port (Shopify fixture), always take the `else` branch. Mark each with `# TODO: WooCommerce` comment for later phases.

### Currency conversion
The `EXCHANGE_RATES` table is **hardcoded** (6 currencies, fixed rates). `convertCurrency` is used in two places: (1) `getDailyVariableContribution` internally for `WorkspaceCost.currency → storeCurrency`, and (2) misc expense fixed costs and founder salary conversion. The same table exists in `lib/workspace-costs.ts` — the route has its own copy. Python should have one shared `src/lib/currency.py`.

### `workspace.meta_ads_connections` is singular
Despite the name `meta_ads_connections` (plural), it is a single relation (one Meta connection per workspace). The `selected_ad_account_ids` array takes priority over `selected_ad_account_id` scalar. Same pattern for `google_ads_connections`.
