CREATE TABLE IF NOT EXISTS "workspace_festivals" (
  "id" TEXT PRIMARY KEY,
  "workspace_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "start_date" TIMESTAMP(3) NOT NULL,
  "end_date" TIMESTAMP(3) NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#F59E0B',
  "expected_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  "regions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "is_template" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_festivals_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_festivals_workspace_id_name_start_date_key"
  ON "workspace_festivals" ("workspace_id", "name", "start_date");

CREATE INDEX IF NOT EXISTS "workspace_festivals_workspace_id_start_date_idx"
  ON "workspace_festivals" ("workspace_id", "start_date");
