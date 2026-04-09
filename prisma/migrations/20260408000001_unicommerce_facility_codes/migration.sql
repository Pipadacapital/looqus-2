ALTER TABLE "unicommerce_connections"
ADD COLUMN IF NOT EXISTS "facility_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
