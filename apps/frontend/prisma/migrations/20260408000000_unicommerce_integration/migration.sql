-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = ''ProductDataSource'') THEN
    CREATE TYPE "ProductDataSource" AS ENUM (''SHOPIFY'', ''UNICOMMERCE'');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "workspaces"
ADD COLUMN IF NOT EXISTS "product_data_source" "ProductDataSource" NOT NULL DEFAULT ''SHOPIFY'';

-- CreateTable
CREATE TABLE IF NOT EXISTS "unicommerce_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "tenant" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "access_token" TEXT,
  "token_obtained_at" TIMESTAMP(3),
  "status" "ConnectionStatus" NOT NULL DEFAULT ''CONNECTED'',
  "last_sync_at" TIMESTAMP(3),
  "last_sync_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "unicommerce_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "unicommerce_products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connection_id" UUID NOT NULL,
  "sku_code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT,
  "mrp" DECIMAL(12,2),
  "image_url" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "inventory" INTEGER,
  "raw_json" JSONB,
  "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unicommerce_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "unicommerce_connections_workspace_id_key" ON "unicommerce_connections"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "unicommerce_products_connection_id_sku_code_key" ON "unicommerce_products"("connection_id", "sku_code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "unicommerce_products_connection_id_idx" ON "unicommerce_products"("connection_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = ''unicommerce_connections_workspace_id_fkey''
  ) THEN
    ALTER TABLE "unicommerce_connections"
    ADD CONSTRAINT "unicommerce_connections_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = ''unicommerce_products_connection_id_fkey''
  ) THEN
    ALTER TABLE "unicommerce_products"
    ADD CONSTRAINT "unicommerce_products_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "unicommerce_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
