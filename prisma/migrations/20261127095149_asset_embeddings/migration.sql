-- CreateTable
CREATE TABLE "asset_embedding" (
    "assetId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_embedding_pkey" PRIMARY KEY ("assetId")
);

-- CreateIndex
CREATE INDEX "asset_embedding_ownerId_idx" ON "asset_embedding"("ownerId");

-- AddForeignKey
ALTER TABLE "asset_embedding" ADD CONSTRAINT "asset_embedding_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
