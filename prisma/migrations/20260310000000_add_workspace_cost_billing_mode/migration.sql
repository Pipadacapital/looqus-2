-- Add billing mode for Shipping and Packaging: monthly (flat per month) or per_order (charge per order).
-- Existing rows default to monthly to preserve current behavior.
CREATE TYPE "WorkspaceCostBillingMode" AS ENUM ('monthly', 'per_order');

ALTER TABLE "workspace_costs"
  ADD COLUMN "billing_mode" "WorkspaceCostBillingMode" NOT NULL DEFAULT 'monthly';

COMMENT ON COLUMN "workspace_costs"."billing_mode" IS 'For SHIPPING/PACKAGING: monthly = flat monthly amount (allocated by day); per_order = amount × order count. Ignored for other cost types.';
