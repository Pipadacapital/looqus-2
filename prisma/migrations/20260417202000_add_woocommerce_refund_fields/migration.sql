ALTER TABLE "woocommerce_orders"
ADD COLUMN "total_refund" DECIMAL(12,2),
ADD COLUMN "product_refund" DECIMAL(12,2),
ADD COLUMN "shipping_refund" DECIMAL(12,2);
