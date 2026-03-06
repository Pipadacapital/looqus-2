-- AlterTable: add Shopify-derived return fields for P&L (refunds = total_returns, productRefunds = returns, shippingRefunds = total_returns - returns)
ALTER TABLE "shopify_analytics_daily" ADD COLUMN IF NOT EXISTS "total_returns" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "returns" DECIMAL(12,2);
