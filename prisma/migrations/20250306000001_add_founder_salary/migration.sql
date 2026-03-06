-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "founder_salary_monthly" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "founder_salary_currency" VARCHAR(3);
