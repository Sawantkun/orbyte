-- CreateTable
CREATE TABLE "instance_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instance_setting_pkey" PRIMARY KEY ("key")
);
