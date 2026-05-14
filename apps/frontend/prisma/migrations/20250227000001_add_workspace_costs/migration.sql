-- CreateEnum
CREATE TYPE "WorkspaceCostType" AS ENUM ('SHIPPING', 'PACKAGING', 'PAYMENT_GATEWAY', 'CUSTOM');

-- CreateTable
CREATE TABLE "workspace_costs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "cost_type" "WorkspaceCostType" NOT NULL,
    "name" VARCHAR(120),
    "amount" DECIMAL(12,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "currency" VARCHAR(3) DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_costs_workspace_id_cost_type_effective_from_effectiv_idx" ON "workspace_costs"("workspace_id", "cost_type", "effective_from", "effective_to");

-- AddForeignKey
ALTER TABLE "workspace_costs" ADD CONSTRAINT "workspace_costs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
