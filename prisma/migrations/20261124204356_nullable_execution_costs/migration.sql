-- AlterTable
ALTER TABLE "node_execution" ALTER COLUMN "costUsd" DROP NOT NULL,
ALTER COLUMN "costUsd" DROP DEFAULT;
