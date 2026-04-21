-- Add currency tracking for ad platform connections.
ALTER TABLE "meta_ads_connections"
ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3) DEFAULT 'USD';

ALTER TABLE "google_ads_connections"
ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3) DEFAULT 'USD';
