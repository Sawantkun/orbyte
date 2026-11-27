-- AlterTable
ALTER TABLE "integration" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Existing credentials: the most recently updated one per owner and provider becomes the default.
UPDATE "integration" i SET "isDefault" = true
WHERE i."id" IN (
  SELECT DISTINCT ON ("ownerId", "provider") "id" FROM "integration" ORDER BY "ownerId", "provider", "updatedAt" DESC
);

-- At most one default per owner and provider.
CREATE UNIQUE INDEX "integration_one_default" ON "integration" ("ownerId", "provider") WHERE "isDefault";
