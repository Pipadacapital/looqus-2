-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "skipped_shopify_order_tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "skip_zero_sales_orders" BOOLEAN NOT NULL DEFAULT false;
