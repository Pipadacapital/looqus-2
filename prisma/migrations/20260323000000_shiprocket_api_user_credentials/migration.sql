ALTER TABLE "shiprocket_connections"
ADD COLUMN IF NOT EXISTS "shiprocket_api_email" TEXT,
ADD COLUMN IF NOT EXISTS "shiprocket_api_password" TEXT;
