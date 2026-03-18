-- Per campaign-day funnel stages (conversion_action rollup from GAQL).
CREATE TABLE "google_ads_funnel_daily" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "stage" VARCHAR(32) NOT NULL,
    "conversions" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "conversion_value" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_ads_funnel_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_ads_funnel_daily_connection_id_customer_id_campaign_id_date_stage_key" ON "google_ads_funnel_daily"("connection_id", "customer_id", "campaign_id", "date", "stage");

CREATE INDEX "google_ads_funnel_daily_connection_id_customer_id_date_idx" ON "google_ads_funnel_daily"("connection_id", "customer_id", "date");

ALTER TABLE "google_ads_funnel_daily" ADD CONSTRAINT "google_ads_funnel_daily_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "google_ads_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
