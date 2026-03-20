-- AlterTable
ALTER TABLE "shiprocket_shipments" ADD COLUMN IF NOT EXISTS "delivery_pincode" TEXT;
ALTER TABLE "shiprocket_shipments" ADD COLUMN IF NOT EXISTS "delivery_city" TEXT;
ALTER TABLE "shiprocket_shipments" ADD COLUMN IF NOT EXISTS "delivery_state" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shiprocket_shipments_connection_id_delivery_pincode_idx" ON "shiprocket_shipments"("connection_id", "delivery_pincode");
