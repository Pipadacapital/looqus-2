-- CreateEnum: StorePlatform
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StorePlatform') THEN
    CREATE TYPE "StorePlatform" AS ENUM ('SHOPIFY', 'WOOCOMMERCE');
  END IF;
END $$;

-- AlterTable: add platform column to workspaces
ALTER TABLE "workspaces"
ADD COLUMN IF NOT EXISTS "platform" "StorePlatform" NOT NULL DEFAULT 'SHOPIFY';

-- CreateTable: woocommerce_connections
CREATE TABLE IF NOT EXISTS "woocommerce_connections" (
  "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"   UUID         NOT NULL,
  "store_url"      TEXT         NOT NULL,
  "consumer_key"   TEXT         NOT NULL,
  "consumer_secret" TEXT        NOT NULL,
  "status"         "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
  "last_sync_at"   TIMESTAMP(3),
  "last_sync_error" TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "woocommerce_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable: woocommerce_orders
CREATE TABLE IF NOT EXISTS "woocommerce_orders" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "connection_id"    UUID         NOT NULL,
  "wc_order_id"      INTEGER      NOT NULL,
  "order_number"     TEXT,
  "status"           TEXT,
  "currency"         TEXT,
  "total"            DECIMAL(12,2),
  "subtotal"         DECIMAL(12,2),
  "discount_total"   DECIMAL(12,2),
  "shipping_total"   DECIMAL(12,2),
  "total_tax"        DECIMAL(12,2),
  "payment_method"   TEXT,
  "is_cod"           BOOLEAN      NOT NULL DEFAULT false,
  "customer_id"      INTEGER,
  "customer_email"   TEXT,
  "customer_phone"   TEXT,
  "billing_city"     TEXT,
  "billing_postcode" TEXT,
  "billing_state"    TEXT,
  "shipping_city"    TEXT,
  "shipping_postcode" TEXT,
  "shipping_state"   TEXT,
  "date_created"     TIMESTAMP(3),
  "date_paid"        TIMESTAMP(3),
  "raw_json"         JSONB,
  "synced_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "woocommerce_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable: woocommerce_line_items
CREATE TABLE IF NOT EXISTS "woocommerce_line_items" (
  "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
  "order_id"       UUID         NOT NULL,
  "wc_line_item_id" INTEGER     NOT NULL,
  "product_id"     INTEGER,
  "variation_id"   INTEGER,
  "name"           TEXT,
  "sku"            TEXT,
  "quantity"       INTEGER,
  "price"          DECIMAL(12,2),
  "subtotal"       DECIMAL(12,2),
  "total"          DECIMAL(12,2),
  "raw_json"       JSONB,
  CONSTRAINT "woocommerce_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: woocommerce_products
CREATE TABLE IF NOT EXISTS "woocommerce_products" (
  "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
  "connection_id"  UUID         NOT NULL,
  "wc_product_id"  INTEGER      NOT NULL,
  "name"           TEXT,
  "slug"           TEXT,
  "sku"            TEXT,
  "status"         TEXT,
  "stock_quantity" INTEGER,
  "regular_price"  DECIMAL(12,2),
  "sale_price"     DECIMAL(12,2),
  "categories"     JSONB,
  "images"         JSONB,
  "raw_json"       JSONB,
  "synced_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "woocommerce_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique
CREATE UNIQUE INDEX IF NOT EXISTS "woocommerce_connections_workspace_id_key"
  ON "woocommerce_connections"("workspace_id");

CREATE UNIQUE INDEX IF NOT EXISTS "woocommerce_orders_connection_id_wc_order_id_key"
  ON "woocommerce_orders"("connection_id", "wc_order_id");

CREATE UNIQUE INDEX IF NOT EXISTS "woocommerce_products_connection_id_wc_product_id_key"
  ON "woocommerce_products"("connection_id", "wc_product_id");

-- CreateIndex: regular
CREATE INDEX IF NOT EXISTS "woocommerce_orders_connection_id_idx"
  ON "woocommerce_orders"("connection_id");

CREATE INDEX IF NOT EXISTS "woocommerce_orders_date_created_idx"
  ON "woocommerce_orders"("date_created");

CREATE INDEX IF NOT EXISTS "woocommerce_line_items_order_id_idx"
  ON "woocommerce_line_items"("order_id");

CREATE INDEX IF NOT EXISTS "woocommerce_line_items_sku_idx"
  ON "woocommerce_line_items"("sku");

CREATE INDEX IF NOT EXISTS "woocommerce_products_connection_id_idx"
  ON "woocommerce_products"("connection_id");

-- AddForeignKey: woocommerce_connections → workspaces
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'woocommerce_connections_workspace_id_fkey'
  ) THEN
    ALTER TABLE "woocommerce_connections"
    ADD CONSTRAINT "woocommerce_connections_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: woocommerce_orders → woocommerce_connections
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'woocommerce_orders_connection_id_fkey'
  ) THEN
    ALTER TABLE "woocommerce_orders"
    ADD CONSTRAINT "woocommerce_orders_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "woocommerce_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: woocommerce_line_items → woocommerce_orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'woocommerce_line_items_order_id_fkey'
  ) THEN
    ALTER TABLE "woocommerce_line_items"
    ADD CONSTRAINT "woocommerce_line_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "woocommerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: woocommerce_products → woocommerce_connections
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'woocommerce_products_connection_id_fkey'
  ) THEN
    ALTER TABLE "woocommerce_products"
    ADD CONSTRAINT "woocommerce_products_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "woocommerce_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
