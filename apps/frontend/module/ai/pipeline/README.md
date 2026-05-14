# AI Pipeline

Flow: **User question → Intent classifier → Metrics fetcher → Context builder (with signals) → Ollama → Response**

## Pipeline stages

1. **Intent classifier** (`pipeline/intent-classifier.ts`)  
   Classifies input into: `insights` | `chat` | `trends` | `anomalies` | `summary`.  
   Used to route and tailor prompts (e.g. “only anomalies” vs full insights).  
   Currently rule-based (keywords); can be replaced with a small LLM call later.

2. **Metrics fetcher**  
   `loadContextWithTrend(prisma, workspaceId, days)` loads:
   - Current period: `workspace_daily_metrics` (from DB), end date = yesterday.
   - Prior period: same length for trend comparison.  
   Returns `context`, `trend`, `priorContext`.

3. **Signals** (`pipeline/signals.ts`)  
   From daily + summary + prior summary we compute:
   - **Anomalies**: days where a metric is > 2σ from period mean (net sales, orders, ad spend, CM2, CM3, RTO%).
   - **Spikes**: day-over-day increase ≥ 25%.
   - **Drops**: day-over-day decrease ≥ 25%.
   - **Trends**: period-over-period % change (net sales, orders, AOV, ad spend, CM2, CM3, ROAS).

4. **Context builder** (`pipeline/context-builder.ts`)  
   Merges metrics text (summary + last 14 days) with a **Pre-computed signals** section (anomalies, spikes, drops, trends).  
   The model sees clear “ALERT”/“TREND” lines so it can cite dates and metrics.

5. **Model**  
   - **Insights**: `generateInsights(context, { model, signals })` uses enriched context and returns structured JSON insights.  
   - **Chat**: `chatWithContext(context, messages, { model, signals })` uses the same enriched context in the system message.

## Making insights more robust and “amazing”

- **Intent-aware prompts**: Use classifier result to shorten or specialize the prompt (e.g. “anomalies only” → fewer tokens, clearer task).
- **Stricter JSON**: Enforce schema (e.g. Zod) on model output and retry with a simpler prompt on parse failure.
- **Citations**: Keep asking the model to cite date/metric in `reason`; optionally parse and link to the relevant day in the UI.
- **Caching**: Cache `context + signals` per `(workspaceId, days)` for 1–5 minutes to avoid recomputing on every “Regenerate”.
- **Multi-model fallback**: If Ollama fails or returns invalid JSON, retry with a smaller model or return a friendly “Unable to generate; try again or check Ollama” message.
- **Feedback**: Store “helpful / not helpful” (or similar) per insight in DB for future tuning and A/B tests.
- **Campaign-level context**: When you add Meta/Google campaign data to the context, the model can suggest “pause campaign X” or “shift budget to Y”.
- **Thresholds as config**: Make spike/drop % and anomaly Z-score configurable (env or workspace settings).
- **Rate limiting**: Throttle heavy Ollama calls per workspace so one user doesn’t block others.
