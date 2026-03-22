# AI Insights Engine — Full Data & Calculation Map

## Every Page: What Data It Fetches & What It Calculates

---

### 1. P&L (`/pnl`)
**API:** `/api/workspaces/[slug]/pnl`
**Prisma Tables:** ShopifyDailyAggregate, ShopifyLineItemAggregate, workspaceCost, metaAdDaily, googleAdDaily, shiprocketShipment
**Calculations:**
- `getBuckets()`, `getBucketUtcDateStrings()`, `allocateMonthlyToBucket()` — time bucketing (day/week/month/quarter)
- `getFilteredDailyAggregates()` — daily order/revenue aggregates with order filters
- `computeLineItemsCogs()`, `normalizeCogsSettings()` — COGS per line item
- `getDailyVariableContribution()` — shipping, packaging, website costs
- `totalChargesFromRaw()` — Shiprocket charge aggregation
- `getLogisticsSummary()` — RTO/COD/forward charges
**Metrics Produced:** Gross Sales, Discounts, Net Sales, COGS, Variable Costs, CM1, Ad Spend (Meta+Google), CM2, Fixed Costs, CM3, Net Profit, all margins, orders count — bucketed by time

---

### 2. Waterfall (`/waterfall`)
**API:** `/api/workspaces/[slug]/waterfall`
**Prisma Tables:** Same as P&L + ShopifyOrder (for new/existing customer split)
**Calculations:** Same as P&L but flat (no time bucketing)
**Metrics Produced:** Full revenue waterfall: Gross → Discounts → Net → COGS → Variable → CM1 → Ads → CM2 → Fixed → CM3 → Net Profit + NRC split (new vs existing customer)

---

### 3. Acquisition (`/acquisition`)
**API:** `/api/workspaces/[slug]/acquisition`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder, ShopifyLineItem, metaAdDaily, googleAdDaily, shiprocketShipment, workspaceCost
**Calculations:**
- `computeAcquisition()` — new customer metrics
- `computeAcquisitionTrend()` — trend over time
- `computeAcquisitionComposition()` — breakdown by dimension
- `fetchCustomerFirstOrdersInRange()` — identifies first-time buyers
- `fetchAdSpendMapsWithClassification()` — ad spend by campaign intent
- `fetchStoreNetRevenueForPeriod()` — net revenue
- `resolveLineItemCogs()` — COGS
- `getDailyVariableContribution()` — variable costs
- `buildGoalEvaluations()` — goal tracking
**Metrics Produced:** New Customer CM2, New Customer Revenue, New Customer ROAS, New Customer Orders, Ad Spend by platform, Refunds

---

### 4. Cohorts (`/cohorts`)
**API:** `/api/workspaces/[slug]/cohorts`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder, ShopifyLineItem, shiprocketShipment, workspaceCost, workspaceMiscExpense
**Calculations:**
- `computeCohorts()` — full cohort analysis engine
- `fetchCustomerFirstOrdersInRange()` — cohort assignment
- `buildDailyRates()` — per-day cost rates
- `resolveLineItemCogs()` — COGS
- `getDailyVariableContribution()` — variable costs
**Metrics Produced:** Cohort table by acquisition month → CM3, Revenue, Repeat %, Repurchase Rate, LTV/CAC — modes: post-acquisition, cumulative, incremental, percentage

---

### 5. Lifetime Value (`/lifetime-value`)
**API:** `/api/workspaces/[slug]/lifetime-value`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder, ShopifyLineItem, shiprocketShipment, workspaceCost
**Calculations:**
- `computeLtv()` — LTV by dimension (product, variant, vendor, collection, tags, etc.)
- `fetchCustomerFirstOrdersInRange()` — first order identification
- `resolveLineItemCogs()` — COGS
- `getDailyVariableContribution()` — variable costs
**Metrics Produced:** CM2, Revenue, Repeat Rate — by dimension, modes: cumulative, post-acquisition, incremental

---

### 6. Timings (`/timings`)
**API:** `/api/workspaces/[slug]/timings`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder, ShopifyLineItem
**Calculations:**
- `computeTimings()` — repurchase timing analysis
- `fetchCustomerFirstOrdersInRange()` — first orders
- `median()`, `mean()` — statistical functions
**Metrics Produced:** 1st→2nd, 2nd→3rd, 3rd→4th order days (median), % customers reaching each order, reactivation window, grouped by product/variant/vendor

---

### 7. Distributions (`/distributions`)
**API:** `/api/workspaces/[slug]/distributions`
**Prisma Tables:** ShopifyOrder, ShopifyLineItem
**Calculations:**
- `computeDistributions()` — per-product distribution analysis
- `computeMode()`, `computeMean()` — statistical functions
- `resolveLineItemCogs()` — COGS
- `getDailyRates()` — variable costs
**Metrics Produced:** CM1 and Sales distributions per product — mode, mean, diff, histogram buckets

---

### 8. Customer Lifecycle (`/customer-lifecycle`)
**API:** `/api/workspaces/[slug]/customer-lifecycle`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder
**Calculations:**
- `computeCustomerLifecycleReport()` — lifecycle stage classification
- `classifyCustomerLifecycle()` — Active / Dormant / Churned / Never Active
- `computeChurnThresholds()` — empirical p40/p80 from purchase gaps
**Metrics Produced:** Customer counts by stage, cohort-based revenue windows, churn thresholds

---

### 9. First Product Cascade (`/first-product-cascade`)
**API:** `/api/workspaces/[slug]/first-product-cascade`
**Prisma Tables:** ShopifyCustomer, ShopifyOrder, ShopifyLineItem
**Calculations:**
- `computeFirstProductCascade()` — first product attribution
- `pickPrimaryFirstProductLine()` — primary product selection (highest gross)
**Metrics Produced:** Product sequence patterns (1st → 2nd → 3rd product), revenue per sequence, repeat rates

---

### 10. Meta Ads (`/meta-ads`)
**API:** `/api/workspaces/[slug]/meta-ads/metrics` + `/meta-ads/creative`
**Prisma Tables:** metaAdDaily, metaVideoCreative
**Calculations:**
- `addMetaDailyRowToAccumulator()`, `accumulatorToMetaSnapshot()` — funnel aggregation
- `resolveCampaignIntent()`, `matchesIntentFilter()` — campaign intent classification
- `diagnoseMetaFunnel()` — funnel diagnostics
- `emptyIntentBuckets()`, `addMetricToIntentBuckets()` — intent-based aggregation
- `fetchAdSpendMapsWithClassification()` — spend classification
- `buildGoalEvaluations()` — goal metrics
**Metrics Produced:** Spend, Impressions, Clicks, CTR, Leads, Purchases, ROAS, CPA, CAC — by campaign/adset/daily, split by intent (Branded/Generic/Awareness)

---

### 11. Google Ads (`/google-ads`)
**API:** `/api/workspaces/[slug]/google-ads/metrics`
**Prisma Tables:** googleAdDaily
**Calculations:**
- `diagnoseGoogleFunnel()` — funnel diagnostics
- `googleMergedFunnelSnapshot()` — merge funnel stages
- `addFunnelDailyRow()`, `emptyGoogleStagedCounts()` — funnel aggregation
- `mapGoogleConversionActionToStage()` — conversion action mapping
- `fetchAdSpendMapsWithClassification()` — spend classification
- `buildGoalEvaluations()` — goal metrics
**Metrics Produced:** Spend, Impressions, Clicks, CTR, Conversions (click/view-through), ROAS, CPA — by campaign/daily

---

### 12. Products (`/products`)
**API:** `/api/workspaces/[slug]/products`
**Prisma Tables:** ShopifyProduct, ShopifyProductVariant, ShopifyOrder, ShopifyLineItem, ShopifyReturn
**Calculations:**
- `computeProducts()` — product profitability engine
- `resolveLineItemCogs()`, `getOrderCogs()` — COGS
- `getDailyRates()`, `getEffectiveDailyAggregates()` — costs
**Metrics Produced:** Sales, Refunds, Revenue, COGS, Variable Costs, CM1, CM1%, Units, Return Rate, Orders (new/existing), AOV, Pareto Grade — by product/variant/vendor/collection/type

---

### 13. Inventory (`/inventory`)
**API:** `/api/workspaces/[slug]/inventory`
**Prisma Tables:** ShopifyProduct, ShopifyProductVariant, ShopifyInventoryLevel, ShopifyOrder, ShopifyLineItem
**Calculations:**
- `classifyInventoryStatus()` — Overstock / Optimal / Low / Out
- `computeDaysLeft()` — days of inventory at current velocity
- `computeSellThrough()` — sell-through rate
**Metrics Produced:** Current stock, sell-through rate, days left, inventory status per variant

---

### 14. Logistics (`/logistics`)
**API:** `/api/workspaces/[slug]/logistics`
**Prisma Tables:** shiprocketShipment, shiprocketOrder
**Calculations:**
- `getLogisticsSummary()` — operational summary
- `totalChargesFromRaw()` — charge breakdown
**Metrics Produced:** Total shipments, Delivered count, RTO count, Forward/COD/RTO charges, RTO rate, COD rate, avg shipment cost

---

### 15. RTO Analytics (`/rto-analytics`)
**API:** `/api/workspaces/[slug]/rto-analytics`
**Prisma Tables:** ShopifyOrder, ShopifyLineItem, shiprocketShipment, shiprocketOrder
**Calculations:**
- `getRtoAnalytics()` — RTO breakdown
**Metrics Produced:** RTO count, RTO rate, RTO cost, Revenue lost — broken down by payment method, courier, product

---

### 16. Pincode Intelligence (`/pincode-intelligence`)
**API:** `/api/workspaces/[slug]/pincode-intelligence`
**Prisma Tables:** shiprocketShipment (rawJson), ShopifyOrder, ShopifyLineItem
**Calculations:**
- `getPincodeIntelligence()` — pincode-level aggregation
**Metrics Produced:** Per-pincode: orders, revenue, RTO count/rate, COD count/rate, delivered count

---

### 17. COD vs Prepaid (`/cod-prepaid`)
**API:** `/api/workspaces/[slug]/cod-prepaid-analytics`
**Prisma Tables:** shiprocketShipment, shiprocketOrder
**Calculations:**
- `getCodPrepaidAnalytics()` — COD vs Prepaid comparison
**Metrics Produced:** Orders, RTO rate, Realization rate, Effective revenue — compared COD vs Prepaid with break-even analysis

---

### 18. Calendar (`/calendar`)
**API:** `/api/workspaces/[slug]/calendar-report`
**Prisma Tables:** ShopifyOrder, ShopifyLineItem, ShopifyDailyAggregate, workspaceFestival, workspaceMarketingAction
**Calculations:**
- `computeCalendarReport()` — daily metrics with event markers
**Metrics Produced:** Daily Sales, Revenue, Orders, CM + festival/campaign markers

---

### 19. Email & SMS (`/email-sms`)
**API:** `/api/workspaces/[slug]/email-sms-report`
**Prisma Tables:** emailCampaign, emailSmsMetric
**Calculations:**
- `aggregateEmailPerformance()` — email/SMS aggregation
**Metrics Produced:** Delivered, Opens, Clicks, Open Rate, Click Rate, Revenue, RPR — by campaign/flow/date/channel

---

### 20. Analytics (`/analytics`) & Dashboard (`/dashboard`) & Store (`/store`)
**These are mostly display pages** — they show connection status, raw Shopify data (orders/products/customers lists), or redirect to other pages. Minimal calculations.

---

## Shared Calculation Modules (used across pages)

| Module | Location | Used By |
|--------|----------|---------|
| COGS Resolution | `lib/cogs/resolve.ts` | P&L, Waterfall, Acquisition, Cohorts, LTV, Products, Distributions |
| Variable Costs | `lib/workspace-costs.ts` → `getDailyVariableContribution()` | P&L, Waterfall, Acquisition, Cohorts, LTV, Products, Distributions |
| Daily Aggregates | `lib/effective-daily.ts` → `getEffectiveDailyAggregates()` | P&L, Acquisition, Products, Distributions |
| Order Filters | `lib/order-filters.ts` → `getOrderInclusionWhere()` | P&L, Waterfall, RTO, Timings, Calendar, Lifecycle |
| First Order Finder | `lib/metrics/customer-first-order.ts` | Acquisition, Cohorts, LTV, Timings, First Product Cascade |
| Ad Spend Classifier | `lib/metrics/ads-spend.ts` | Acquisition, Meta Ads, Google Ads |
| Campaign Intent | `lib/metrics/campaign-classification.ts` | Meta Ads, Google Ads |
| Goal Evaluation | `lib/metrics/goals.ts` | Acquisition, Meta Ads, Google Ads |
| Logistics Summary | `lib/workspace-metrics/logistics-summary.ts` | Logistics, P&L, Waterfall |
| Time Bucketing | `lib/pnl/buckets.ts` | P&L |
| Churn Thresholds | `lib/metrics/churn-thresholds.ts` | Customer Lifecycle |

---

## Prisma Models Used (Complete)

| Model | Pages Using It |
|-------|---------------|
| ShopifyOrder | P&L, Waterfall, Acquisition, Cohorts, LTV, Timings, Distributions, Products, RTO, Pincode, Calendar, Store, Lifecycle, First Product |
| ShopifyLineItem | P&L, Waterfall, Acquisition, Cohorts, LTV, Timings, Distributions, Products, RTO, Pincode, Calendar, First Product |
| ShopifyCustomer | Acquisition, Cohorts, LTV, Timings, Lifecycle, First Product, Store |
| ShopifyProduct | Products, Inventory, Store |
| ShopifyProductVariant | Products, Inventory |
| ShopifyInventoryLevel | Inventory |
| ShopifyDailyAggregate | P&L, Waterfall, Acquisition, Calendar |
| ShopifyReturn | Products |
| metaAdDaily | P&L, Waterfall, Acquisition, Meta Ads |
| googleAdDaily | P&L, Waterfall, Acquisition, Google Ads |
| shiprocketShipment | P&L, Waterfall, Acquisition, Cohorts, LTV, Logistics, RTO, Pincode, COD-Prepaid |
| shiprocketOrder | Logistics, RTO, COD-Prepaid, Shiprocket |
| workspaceCost | P&L, Waterfall, Acquisition, Cohorts, LTV |
| workspaceMiscExpense | Cohorts |
| workspaceFestival | Calendar |
| workspaceMarketingAction | Calendar |
| emailCampaign / emailSmsMetric | Email-SMS |
