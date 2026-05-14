# Integrations Setup

## Meta Ads

### Required Environment Variables

| Variable | Description |
|---|---|
| `META_APP_ID` | Meta App ID from [developers.facebook.com](https://developers.facebook.com/apps/) |
| `META_APP_SECRET` | Meta App Secret |
| `META_REDIRECT_URI` | Must be `{APP_URL}/api/integrations/meta/callback` |
| `META_API_VERSION` | Graph API version (default: `v21.0`) |
| `META_CONFIG_ID` | _(optional)_ Facebook Login for Business config ID |

### Setup Steps

1. Create a Meta App at [developers.facebook.com](https://developers.facebook.com/apps/)
2. Add "Facebook Login for Business" product
3. Configure the OAuth redirect URI to point to your callback URL
4. Request the following permissions: `ads_management`, `ads_read`, `business_management`, `read_insights`
5. Copy App ID and App Secret into `.env`

### How it works

- User clicks "Connect Meta Ads" on the dashboard
- Redirected to Meta OAuth consent screen
- On approval, we exchange the code for a short-lived token, then upgrade to a long-lived token (~60 days)
- We fetch all accessible ad accounts and store them
- Daily sync pulls campaign-level insights (impressions, clicks, spend, conversions)

### Troubleshooting

- **No ad accounts found**: The Facebook user may not have access to any ad accounts. Check Business Manager permissions.
- **Token expired**: Long-lived tokens last ~60 days. The user needs to reconnect when expired.
- **Missing permissions**: Ensure the Meta App has `ads_read` and `read_insights` permissions approved.

---

## Google Ads

### Required Environment Variables

| Variable | Description |
|---|---|
| `GOOGLE_ADS_CLIENT_ID` | OAuth Client ID from [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth Client Secret |
| `GOOGLE_ADS_REDIRECT_URI` | Must be `{APP_URL}/api/integrations/google/callback` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Developer token from [Google Ads API Center](https://ads.google.com/aw/apicenter) |
| `GOOGLE_ADS_API_VERSION` | API version (default: `v18`) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | _(optional)_ Manager account customer ID (no dashes) |

### Setup Steps

1. Create an OAuth 2.0 Client ID (Web application) in Google Cloud Console
2. Add the redirect URI to Authorized redirect URIs
3. Enable the Google Ads API in your GCP project
4. Get a developer token from the Google Ads API Center (Settings > API Center in Google Ads)
5. Copy all credentials into `.env`

### How it works

- User clicks "Connect Google Ads" on the dashboard
- Redirected to Google OAuth consent with `offline` access (to get a refresh token)
- We use `prompt=consent` to ensure a refresh token is always returned
- We list all accessible customer IDs and store them
- Daily sync runs GAQL queries for campaign-level metrics

### Troubleshooting

- **No refresh token**: Google only returns a refresh token on the first consent. We force `prompt=consent` to ensure it. If missing, disconnect and reconnect.
- **"Not a manager" errors**: If you manage multiple accounts under an MCC, set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the MCC customer ID (no dashes).
- **Developer token pending**: Test accounts work while your developer token is pending approval. For production data, you need an approved developer token.
- **Scope errors**: Ensure the Google Ads API is enabled in your GCP project.

### Google Ads vs Google AdSense

- **Google Ads** (what we integrate): For *advertisers* who run campaigns. We pull ad spend, impressions, clicks, conversions, and conversion value. This is what tools like Triple Whale use for e‑commerce analytics and ROAS.
- **Google AdSense**: For *publishers* who show ads on their site and earn revenue. It uses a different API and product. If you need publisher ad revenue (e.g. for a content site), that would be a separate integration.

### Dashboard performance (Triple Whale–style)

When Google Ads is connected and a customer is selected, the dashboard shows:

- **Last 30 days**: Total spend, conversions, conversion value, ROAS
- **Top campaigns by spend**: Table with spend, conversion value, and ROAS per campaign

Data is read from `google_ads_daily_metrics`. Ensure cron or manual “Sync now” has run so metrics are populated.

### Stored metrics and optional schema additions

We currently store (in `google_ads_daily_metrics`):

- Campaign-level: impressions, clicks, spend, conversions, conversion_value, ctr, average_cpc, date
- ROAS is computed in the API as conversion_value / spend (not stored)

Optional additions if you need them later:

- **Ad group level**: Add GAQL for ad_group in sync and use existing `ad_group_id` / `ad_group_name` columns.
- **View-through conversions**: Add a column and include `metrics.view_through_conversions` in the GAQL query.
- **Video / Performance Max**: Add metrics like `metrics.video_views` and segment by campaign type if needed.

---

## Cron Sync

The endpoint `POST /api/cron/sync-ads` syncs all connected Meta and Google Ads accounts. It is protected by the `CRON_SECRET` header.

```bash
curl -X POST http://localhost:3000/api/cron/sync-ads \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

For production, set up a cron job (e.g., Vercel Cron, Railway, or external) to call this daily.
