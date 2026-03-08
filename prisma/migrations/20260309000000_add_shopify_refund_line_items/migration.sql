-- CreateTable
CREATE TABLE "shopify_refund_line_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "shopify_refund_id" TEXT NOT NULL,
    "shopify_refund_line_id" TEXT NOT NULL,
    "shopify_order_id" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "shopify_line_item_id" TEXT,
    "line_item_id" UUID,
    "product_shopify_id" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "subtotal_amount" DECIMAL(12,2) NOT NULL,
    "total_tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "processed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_refund_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopify_refund_line_items_connection_id_shopify_refund_line__key" ON "shopify_refund_line_items"("connection_id", "shopify_refund_line_id");

-- CreateIndex
CREATE INDEX "shopify_refund_line_items_connection_id_processed_at_idx" ON "shopify_refund_line_items"("connection_id", "processed_at");

-- CreateIndex
CREATE INDEX "shopify_refund_line_items_order_id_idx" ON "shopify_refund_line_items"("order_id");

-- CreateIndex
CREATE INDEX "shopify_refund_line_items_connection_id_product_shopify_id_idx" ON "shopify_refund_line_items"("connection_id", "product_shopify_id");

-- AddForeignKey
ALTER TABLE "shopify_refund_line_items" ADD CONSTRAINT "shopify_refund_line_items_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "shopify_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
