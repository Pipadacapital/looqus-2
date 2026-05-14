CREATE TYPE "WorkspaceGoalPeriodType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "WorkspaceGoalValueType" AS ENUM ('MINIMUM', 'MAXIMUM', 'TARGET');

CREATE TABLE "workspace_metric_goals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "metric_name" VARCHAR(64) NOT NULL,
    "period_type" "WorkspaceGoalPeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "goal_value" DECIMAL(18,6) NOT NULL,
    "goal_type" "WorkspaceGoalValueType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_metric_goals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_metric_goals_workspace_id_metric_name_period_type_period_start_key" ON "workspace_metric_goals"("workspace_id", "metric_name", "period_type", "period_start");
CREATE INDEX "workspace_metric_goals_workspace_id_idx" ON "workspace_metric_goals"("workspace_id");
ALTER TABLE "workspace_metric_goals" ADD CONSTRAINT "workspace_metric_goals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
