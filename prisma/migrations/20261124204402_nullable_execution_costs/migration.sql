-- AlterTable
ALTER TABLE "workflow_execution" ALTER COLUMN "estimatedCostUsd" DROP NOT NULL,
ALTER COLUMN "estimatedCostUsd" DROP DEFAULT;
