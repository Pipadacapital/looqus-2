# Hourly cron for ads sync (non-Vercel)

The `/api/cron/sync-ads` endpoint syncs **only the last 2 days** of Meta and Google Ads data (upsert by date). It does not refetch full history on each run.

**Required:** Set `CRON_SECRET` in your environment. Callers must send:

```http
POST /api/cron/sync-ads
x-cron-secret: <your CRON_SECRET>
```

---

## Option 1: GitHub Actions (free)

Use a scheduled workflow to hit your deployed app every hour.

1. In your repo: **Actions** → **New workflow** → **set up a workflow yourself**.
2. Create `.github/workflows/sync-ads-cron.yml`:

```yaml
name: Sync ads hourly

on:
  schedule:
    # Every hour at minute 0 (00:00, 01:00, …)
    - cron: '0 * * * *'
  workflow_dispatch: # optional: allow manual run

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger sync
        run: |
          curl -sS -X POST \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_URL }}/api/cron/sync-ads"
```

3. In repo **Settings** → **Secrets and variables** → **Actions**, add:
   - `CRON_SECRET`: same value as in your app env
   - `APP_URL`: your app base URL (e.g. `https://yourapp.com`)

---

## Option 2: cron-job.org (free tier)

1. Sign up at [cron-job.org](https://cron-job.org).
2. Create a cron job:
   - **URL:** `https://your-app.com/api/cron/sync-ads`
   - **Schedule:** every 1 hour (or `0 * * * *`)
   - **Request method:** POST
   - **Headers:** add `x-cron-secret` with your `CRON_SECRET` value.

---

## Option 3: System cron (VPS / Linux server)

If the app runs on a server you control:

```bash
# Edit crontab
crontab -e

# Add line (replace URL and ensure CRON_SECRET is set in env or use a literal)
0 * * * * curl -sS -X POST -H "x-cron-secret: YOUR_CRON_SECRET" https://your-app.com/api/cron/sync-ads
```

Or use a small script that reads the secret from env:

```bash
# /opt/scripts/sync-ads-cron.sh
curl -sS -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "https://your-app.com/api/cron/sync-ads"
```

Crontab:

```cron
0 * * * * CRON_SECRET=your_secret /opt/scripts/sync-ads-cron.sh
```

---

## Option 4: Upstash QStash (serverless cron)

[QStash](https://upstash.com/qstash) can call your URL on a schedule (pay per request, free tier available). Configure a schedule to `POST` your `/api/cron/sync-ads` URL with the `x-cron-secret` header.

---

## Summary

| Method           | Best for              | Cost   |
|-----------------|------------------------|--------|
| GitHub Actions   | App on any host        | Free   |
| cron-job.org     | No server access       | Free   |
| System cron      | VPS / same machine     | Free   |
| Upstash QStash   | Serverless / no server | Free tier / paid |

The cron only syncs the **last 2 days** each run (upsert), so it does not refetch all historical data every hour.
