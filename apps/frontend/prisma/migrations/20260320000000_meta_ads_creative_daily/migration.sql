CREATE TABLE "meta_ads_creative_daily" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "ad_id" TEXT NOT NULL,
    "ad_name" TEXT NOT NULL DEFAULT '',
    "campaign_id" TEXT NOT NULL,
    "campaign_name" TEXT NOT NULL DEFAULT '',
    "adset_id" TEXT,
    "adset_name" TEXT,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spend" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "video_3s_views" INTEGER NOT NULL DEFAULT 0,
    "video_thruplay" INTEGER NOT NULL DEFAULT 0,
    "avg_watch_sec" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "video_p25" INTEGER NOT NULL DEFAULT 0,
    "video_p50" INTEGER NOT NULL DEFAULT 0,
    "video_p75" INTEGER NOT NULL DEFAULT 0,
    "video_p95" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "raw_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ads_creative_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meta_ads_creative_daily_connection_id_ad_account_id_ad_id_date_key" ON "meta_ads_creative_daily"("connection_id", "ad_account_id", "ad_id", "date");

CREATE INDEX "meta_ads_creative_daily_connection_ad_account_date_idx" ON "meta_ads_creative_daily"("connection_id", "ad_account_id", "date");

ALTER TABLE "meta_ads_creative_daily" ADD CONSTRAINT "meta_ads_creative_daily_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "meta_ads_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
