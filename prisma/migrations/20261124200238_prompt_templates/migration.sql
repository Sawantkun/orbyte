-- CreateTable
CREATE TABLE "prompt_template" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "variables" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_template_ownerId_updatedAt_idx" ON "prompt_template"("ownerId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "prompt_template_ownerId_name_key" ON "prompt_template"("ownerId", "name");

-- AddForeignKey
ALTER TABLE "prompt_template" ADD CONSTRAINT "prompt_template_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
