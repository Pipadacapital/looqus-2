-- AlterTable: make client_id and client_secret optional on shopify_connections
-- These fields stay for backward compatibility with existing connections but
-- are no longer required for new installs (credentials come from env).
ALTER TABLE "shopify_connections" ALTER COLUMN "client_id" DROP NOT NULL;
ALTER TABLE "shopify_connections" ALTER COLUMN "client_secret" DROP NOT NULL;
