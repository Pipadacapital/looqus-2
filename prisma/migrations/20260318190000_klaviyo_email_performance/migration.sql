-- Klaviyo integration + email/SMS performance storage

CREATE TABLE "klaviyo_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "api_key" TEXT NOT NULL,
    "conversion_metric_id" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "last_sync_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "klaviyo_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "klaviyo_connections_workspace_id_key" ON "klaviyo_connections"("workspace_id");

ALTER TABLE "klaviyo_connections" ADD CONSTRAINT "klaviyo_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "email_performance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "klaviyo_connection_id" UUID NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "source_type" VARCHAR(24) NOT NULL,
    "klaviyo_resource_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(512) NOT NULL,
    "send_date" DATE NOT NULL,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "unique_opens" INTEGER NOT NULL DEFAULT 0,
    "unique_clicks" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unsubscribes" INTEGER NOT NULL DEFAULT 0,
    "spam_complaints" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_performance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_performance_workspace_id_source_type_klaviyo_resource_id_send_date_key" ON "email_performance"("workspace_id", "source_type", "klaviyo_resource_id", "send_date");

CREATE INDEX "email_performance_workspace_id_send_date_idx" ON "email_performance"("workspace_id", "send_date");

CREATE INDEX "email_performance_klaviyo_connection_id_idx" ON "email_performance"("klaviyo_connection_id");

ALTER TABLE "email_performance" ADD CONSTRAINT "email_performance_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_performance" ADD CONSTRAINT "email_performance_klaviyo_connection_id_fkey" FOREIGN KEY ("klaviyo_connection_id") REFERENCES "klaviyo_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
