-- CreateTable
CREATE TABLE "workspace_ad_campaign_classifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "campaign_id" VARCHAR(128) NOT NULL,
    "intent" VARCHAR(32) NOT NULL,
    "campaign_name" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_ad_campaign_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_ad_campaign_classifications_workspace_id_idx" ON "workspace_ad_campaign_classifications"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_ad_campaign_classifications_workspace_id_platform_c_key" ON "workspace_ad_campaign_classifications"("workspace_id", "platform", "campaign_id");

-- AddForeignKey
ALTER TABLE "workspace_ad_campaign_classifications" ADD CONSTRAINT "workspace_ad_campaign_classifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
