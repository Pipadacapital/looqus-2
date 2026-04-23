ALTER TABLE "workspaces" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}'::jsonb;
