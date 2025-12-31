-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CREATOR', 'VERIFIER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ImageStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DetectedLabel" AS ENUM ('AI_GENERATED', 'AI_ASSISTED', 'ORIGINAL', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "hash" TEXT NOT NULL,
    "filename" TEXT,
    "metadata" JSONB,
    "url" TEXT NOT NULL,
    "status" "ImageStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detection_report" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "ai_probability" DOUBLE PRECISION NOT NULL,
    "detectedLabel" "DetectedLabel" NOT NULL,
    "model_name" TEXT,
    "heatmap_url" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "detection_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "images_hash_key" ON "images"("hash");

-- CreateIndex
CREATE INDEX "images_userId_idx" ON "images"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "detection_report_imageId_key" ON "detection_report"("imageId");

-- CreateIndex
CREATE INDEX "detection_report_imageId_idx" ON "detection_report"("imageId");

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detection_report" ADD CONSTRAINT "detection_report_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
