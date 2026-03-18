CREATE TABLE "marketing_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "action_date" DATE NOT NULL,
    "action_type" VARCHAR(48) NOT NULL,
    "action_name" VARCHAR(256) NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "marketing_actions_workspace_id_action_date_idx" ON "marketing_actions"("workspace_id", "action_date");
ALTER TABLE "marketing_actions" ADD CONSTRAINT "marketing_actions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_actions" ADD CONSTRAINT "marketing_actions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
