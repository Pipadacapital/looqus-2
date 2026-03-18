/**
 * Meta video ad creative metrics — aggregated ad-level (sum daily rows in range).
 *
 * ## Formulas (percentages are 0–100)
 * - **Hook rate** = 100 × Σ(3s views) / Σ(impressions on days Meta reported 3s in actions).
 *   Null if no day in range has `3_second_video_view` (or sibling) in actions.
 * - **Hold rate** = 100 × Σ(ThruPlay on those days) / Σ(3s) on same days. Null if hook unknown or 3s sum 0.
 * - **P25 / P50 / P75 / P95 rate** = 100 × quartile watched count / impressions (Meta reports counts).
 * - **CTR** = 100 × clicks / impressions.
 * - **ROAS** = attributed purchase value / spend (pixel purchase, same as campaign view).
 * - **Avg watch (sec)** = Σ(avg_watch_sec × impressions) / Σ(impressions) across days (Meta’s daily
 *   avg is treated as constant over that ad-day’s impressions for weighting).
 *
 * ## Video vs non-video
 * **isVideo** if thruplay, P25, or reported 3s &gt; 0. Otherwise N/A for video rates.
 *
 * ## Diagnostics (heuristic; min impressions default 3000)
 * - **weak_hook**: hook &lt; 12%
 * - **weak_hold**: hook ≥ 5% and hold &lt; 22%
 * - **strong_watch_weak_click**: P75/impr &gt; 10% and CTR &lt; 0.9%
 * - **strong_ad_weak_funnel**: hook &gt; 14%, CTR &gt; 1.0%, ROAS &lt; 1, spend &gt; ₹500
 */

export type MetaVideoCreativeAggregates = {
  impressions: number
  clicks: number
  spend: number
  thruplay: number
  p25: number
  p50: number
  p75: number
  p95: number
  sumAvgWatchWeighted: number
  conversions: number
  revenue: number
  /** Impressions on days where video_3s_views was non-null in DB */
  hookImpressions: number
  /** Sum 3s views on those days */
  hookVideo3s: number
  /** ThruPlay on same days (for hold) */
  hookThruplay: number
}

export type MetaVideoCreativeMetrics = {
  adId: string
  adName: string
  campaignId: string
  campaignName: string
  adsetId: string | null
  adsetName: string | null
  impressions: number
  clicks: number
  spend: number
  isVideo: boolean
  hookRatePct: number | null
  holdRatePct: number | null
  p25RatePct: number | null
  p50RatePct: number | null
  p75RatePct: number | null
  p95RatePct: number | null
  avgWatchSec: number | null
  ctrPct: number
  roas: number
  conversions: number
  diagnostics: MetaVideoCreativeDiagnostic[]
}

export type MetaVideoCreativeDiagnostic =
  | 'weak_hook'
  | 'weak_hold'
  | 'strong_watch_weak_click'
  | 'strong_ad_weak_funnel'

const DIAG_LABELS: Record<MetaVideoCreativeDiagnostic, string> = {
  weak_hook: 'Weak hook',
  weak_hold: 'Weak hold (ThruPlay/3s)',
  strong_watch_weak_click: 'Strong watch, weak click',
  strong_ad_weak_funnel: 'Strong ad engagement, weak ROAS',
}

export function diagnosticLabel(d: MetaVideoCreativeDiagnostic): string {
  return DIAG_LABELS[d]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function emptyMetaVideoAggregates(): MetaVideoCreativeAggregates {
  return {
    impressions: 0,
    clicks: 0,
    spend: 0,
    thruplay: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p95: 0,
    sumAvgWatchWeighted: 0,
    conversions: 0,
    revenue: 0,
    hookImpressions: 0,
    hookVideo3s: 0,
    hookThruplay: 0,
  }
}

export function addCreativeDailyToAggregate(
  acc: MetaVideoCreativeAggregates,
  row: {
    impressions: number
    clicks: number
    spend: number
    /** null = Meta did not return 3s in actions that day */
    video_3s_views: number | null
    video_thruplay: number
    avg_watch_sec: { toString(): string } | number
    video_p25: number
    video_p50: number
    video_p75: number
    video_p95: number
    conversions: number
    revenue: { toString(): string } | number
  }
): void {
  const impr = row.impressions
  acc.impressions += impr
  acc.clicks += row.clicks
  acc.spend += Number(row.spend)
  acc.thruplay += row.video_thruplay
  acc.p25 += row.video_p25
  acc.p50 += row.video_p50
  acc.p75 += row.video_p75
  acc.p95 += row.video_p95
  if (row.video_3s_views != null) {
    acc.hookImpressions += impr
    acc.hookVideo3s += row.video_3s_views
    acc.hookThruplay += row.video_thruplay
  }
  const aws = Number(row.avg_watch_sec)
  if (impr > 0 && aws > 0) acc.sumAvgWatchWeighted += aws * impr
  acc.conversions += row.conversions
  acc.revenue += Number(row.revenue)
}

export function aggregatesToVideoCreativeMetrics(
  meta: {
    adId: string
    adName: string
    campaignId: string
    campaignName: string
    adsetId: string | null
    adsetName: string | null
  },
  a: MetaVideoCreativeAggregates,
  minImpressionsForDiagnostics?: number
): MetaVideoCreativeMetrics {
  const impr = a.impressions
  const isVideo = a.thruplay > 0 || a.p25 > 0 || a.hookVideo3s > 0

  const hookRatePct =
    a.hookImpressions > 0 ? round2((100 * a.hookVideo3s) / a.hookImpressions) : null
  const holdRatePct =
    a.hookVideo3s > 0 ? round2((100 * a.hookThruplay) / a.hookVideo3s) : null
  const p25RatePct = impr > 0 && isVideo ? round2((100 * a.p25) / impr) : null
  const p50RatePct = impr > 0 && isVideo ? round2((100 * a.p50) / impr) : null
  const p75RatePct = impr > 0 && isVideo ? round2((100 * a.p75) / impr) : null
  const p95RatePct = impr > 0 && isVideo ? round2((100 * a.p95) / impr) : null
  const avgWatchSec =
    impr > 0 && a.sumAvgWatchWeighted > 0 ? round2(a.sumAvgWatchWeighted / impr) : null
  const ctrPct = impr > 0 ? round2((100 * a.clicks) / impr) : 0
  const roas = a.spend > 0 ? round2(a.revenue / a.spend) : 0

  const minI = minImpressionsForDiagnostics ?? 3000
  const diagnostics = diagnoseMetaVideoCreative(
    {
      impressions: impr,
      spend: a.spend,
      isVideo,
      hookRatePct,
      holdRatePct,
      p75RatePct,
      ctrPct,
      roas,
    },
    minI
  )

  return {
    ...meta,
    impressions: impr,
    clicks: a.clicks,
    spend: a.spend,
    isVideo,
    hookRatePct,
    holdRatePct,
    p25RatePct,
    p50RatePct,
    p75RatePct,
    p95RatePct,
    avgWatchSec,
    ctrPct,
    roas,
    conversions: a.conversions,
    diagnostics,
  }
}

function diagnoseMetaVideoCreative(
  m: {
    impressions: number
    spend: number
    isVideo: boolean
    hookRatePct: number | null
    holdRatePct: number | null
    p75RatePct: number | null
    ctrPct: number
    roas: number
  },
  minImpr: number
): MetaVideoCreativeDiagnostic[] {
  const out: MetaVideoCreativeDiagnostic[] = []
  if (!m.isVideo || m.impressions < minImpr) return out

  if (m.hookRatePct != null && m.hookRatePct < 12) out.push('weak_hook')
  if (
    m.hookRatePct != null &&
    m.hookRatePct >= 5 &&
    m.holdRatePct != null &&
    m.holdRatePct < 22
  ) {
    out.push('weak_hold')
  }
  if (m.p75RatePct != null && m.p75RatePct > 10 && m.ctrPct < 0.9) {
    out.push('strong_watch_weak_click')
  }
  if (
    m.hookRatePct != null &&
    m.hookRatePct > 14 &&
    m.ctrPct > 1.0 &&
    m.roas < 1 &&
    m.spend > 500
  ) {
    out.push('strong_ad_weak_funnel')
  }
  return out
}
