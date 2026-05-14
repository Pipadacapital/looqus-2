# AI Insights: ROAS Calculation & Metrics (Triple Whale–style)

## How ROAS is calculated (same everywhere)

There is **no separate calculation for AI insights**. We use the same ROAS everywhere (dashboard, Meta/Google Ads pages, and AI).

### Formula

| Source   | Revenue side              | ROAS formula                    |
|----------|---------------------------|---------------------------------|
| **Meta** | `revenue` (from Meta API) | `ROAS = revenue / spend`        |
| **Google** | `conversion_value` (from Google API) | `ROAS = conversion_value / spend` |

- **Spend:** Ad spend from the platform (daily, summed by campaign or total).
- **Meta revenue:** Attributed revenue Meta reports for the ad account (conversions attributed to your ads).
- **Google conversion value:** Value of conversions Google attributes to your campaigns.

So we use **attributed ROAS** only: platform-reported conversion value (or revenue) divided by ad spend. We do **not** currently compute blended ROAS, margin-based ROAS, or product-level ROAS for the AI.

### Where it’s computed

- **Meta:** `lib/insights/aggregate-workspace-metrics.ts` (and `app/api/workspaces/[slug]/meta-ads/metrics/route.ts`):  
  `roas = spend > 0 ? revenue / spend : 0`, then rounded to 2 decimals.
- **Google:** Same file (and google-ads metrics route):  
  `roas = spend > 0 ? conversionValue / spend : 0`, then rounded to 2 decimals.

The AI receives these pre-computed ROAS values (and spend/revenue/conversion value) in the aggregated metrics text; it does not perform any extra ROAS calculation.

---

## What we send to the AI today

- **Period:** from, to, days.
- **Meta (if connected):**  
  Total: spend, revenue, ROAS, impressions, clicks, conversions.  
  Top 5 campaigns: name, spend, revenue, ROAS.
- **Google (if connected):**  
  Total: spend, conversion value, ROAS, impressions, clicks, conversions.  
  Top 5 campaigns: name, spend, conversion value, ROAS.

We also added **CTR, CPC, CPM** (where available) so the model can give ad-efficiency insights with real numbers.

---

## What’s missing for “best” e‑commerce AI insights (Triple Whale–style)

These are the main gaps vs platforms like Triple Whale. Filling them would make AI insights much stronger.

| Missing piece           | Why it matters for AI insights                         | Status / next step |
|-------------------------|--------------------------------------------------------|--------------------|
| **Blended ROAS**        | Total Shopify order revenue / total ad spend. Shows true business ROAS vs platform-attributed. | Need: order revenue by period; add to aggregation and to context for AI. |
| **ROAS trend**          | ROAS (and spend/revenue) this period vs previous. Enables “ROAS dropped 20% vs last month”. | Need: same metrics for prior period in aggregation; pass both to AI. |
| **Contribution margin** | Profit after COGS (and optional variable costs). Enables margin risk and “real” profitability. | Need: COGS (e.g. on product/line item) and optionally variable costs; add margin to metrics and AI context. |
| **Return rate**         | % of revenue (or orders) returned. Enables “high return products” and margin risk. | Need: returns/refunds (e.g. Shopify Refunds API); add return rate to metrics and AI. |
| **Product-level ROAS**  | Which products drive attributed (or blended) revenue per rupee of spend. | Need: product-level attribution or join orders/line items to campaigns; then product ROAS in aggregation and AI. |
| **Attribution clarity** | So the model doesn’t confuse attributed vs blended. | Done in prompt: we state that “ROAS = attributed ROAS (platform conversion value / spend)”. |

Suggested implementation order (from `docs/ads-metrics-implementation.md`):  
(1) Blended ROAS + revenue flow, (2) Return rate, (3) Contribution margin, (4) Product multiple / product ROAS. As each is added, include it in the aggregated metrics and in the AI insight prompt so the model can use it.

---

## Analytics Insights on the dashboard

The dashboard shows **visible AI intelligence** in one card:

- **Latest AI insights** – LLM-generated insights (performance_alert, roas_drop, margin_risk, ad_efficiency) with title, reason, recommendation, confidence.
- **Trend analysis** – % change vs prior period (spend, revenue, ROAS for Meta and Google). Rule-based; no LLM.
- **Anomalies** – Rule-based: spend spikes/drops vs daily average, campaigns with ROAS well below account average. No LLM.
- **Recommendations** – Extracted from the latest AI insights so they’re easy to scan.

**RAG is not used.** Trend and anomalies are computed from the same ad metrics (prior period for trend, daily/campaign aggregates for anomalies). Insights and recommendations come from the LLM with the current metrics in the prompt. RAG would only be needed if you wanted to ground answers in internal playbooks or long doc sets.

---

## Making AI insights more powerful

You **don’t need** a new framework or service to get noticeably better insights. The highest impact comes from **richer context** and **clear prompts**.

### 1. Richer context (no new dependency)

- **ROAS / spend trend** – Add “this period vs previous period” (e.g. last 30d vs prior 30d) to the metrics you send. The model can then say “ROAS dropped 15% vs last month” and give reasons.
- **Blended ROAS** – Once you have total order revenue (Shopify) for the period, add `blended_roas = order_revenue / ad_spend` and send it. The model can compare attributed vs blended and flag gaps.
- **Contribution margin** – When you have COGS (and optional variable costs), add margin or margin % so the model can talk about profitability, not just revenue.
- **Return rate** – Once you have returns/refunds, add return rate so the model can surface “high return products” or margin risk.

Implement these in your aggregation and include them in the same metrics text the AI already receives. No new libraries required.

### 2. Stronger prompt (no new dependency)

- Add **1–2 few-shot examples** in the system prompt (example insight JSON) so the model follows the same structure and depth.
- Be explicit about **what “good” looks like**: e.g. “Recommendations must be specific and actionable (name campaigns or metrics), not generic.”
- Optionally add a **target ROAS** or **benchmarks** in the prompt so the model can say “below target” or “above benchmark.”

### 3. Optional: better or bigger model

- **Larger local model** – e.g. `llama3.1-70b` or `mistral-nemo` via Ollama often gives more consistent and nuanced insights than small models, at the cost of speed and RAM.
- **Cloud API** – If you add OpenAI, Anthropic, or Gemini, you can switch (or fallback) the insight pipeline to a cloud model for stronger reasoning; you’d still send the same aggregated metrics and structured prompt.

### 4. Optional: libraries / structure (only if you want to scale)

- **LangChain / LlamaIndex** – Useful if you later add: multi-step flows, tool use (e.g. “query product ROAS”), or RAG over internal playbooks. Not required for “better insights” today.
- **RAG** – If you have docs (e.g. “how we interpret ROAS,” playbooks), you can retrieve relevant chunks and add them to the system prompt. Helpful when you have a lot of internal knowledge.
- **Evaluation** – Log insight type, confidence, and (if you add it) user feedback (e.g. “helpful” / “not helpful”) so you can tune prompts or models over time.

### Summary

- **No new dependency is required** to make insights more powerful: focus on **more and clearer data** (trend, blended ROAS, margin, returns) and **better prompts** (examples, targets, clarity on “actionable”).
- **Optional:** bigger or cloud model, then later RAG/agents/eval if you want to scale further.

---

## Summary

- **ROAS:** Single definition everywhere: **attributed ROAS = (revenue or conversion value) / spend**. No separate “AI” calculation.
- **AI:** Gets the same aggregated metrics (with ROAS, and now CTR/CPC/CPM where available); no extra ROAS math in the LLM.
- **To get “best” e‑commerce AI insights:** Add blended ROAS, ROAS trend, contribution margin, return rate, and product-level metrics to the pipeline and to the context we send to the AI.
