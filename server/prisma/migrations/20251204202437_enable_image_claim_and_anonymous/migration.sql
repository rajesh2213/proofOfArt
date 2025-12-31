/*
  Warnings:

  - You are about to drop the `_ImageToUser` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `username` on table `users` required. This step will fail if there are existing NULL values in that column.
  - Made the column `email` on table `users` required. This step will fail if there are existing NULL values in that column.
  - Made the column `password_hash` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "EditType" AS ENUM ('INPAINTING', 'OBJECT_REMOVAL', 'CONTENT_AWARE_SCALE');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'VERIFIED_OWNER', 'VERIFIED_UPLOADER', 'REJECTED');

-- DropForeignKey
ALTER TABLE "public"."_ImageToUser" DROP CONSTRAINT "_ImageToUser_A_fkey";

-- DropForeignKey
ALTER TABLE "public"."_ImageToUser" DROP CONSTRAINT "_ImageToUser_B_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "username" SET NOT NULL,
ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "password_hash" SET NOT NULL;

-- DropTable
DROP TABLE "public"."_ImageToUser";

-- CreateTable
CREATE TABLE "image_claims" (
    "userId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "is_primary_owner" BOOLEAN NOT NULL DEFAULT false,
    "upload_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claim_evidence_metadata" JSONB,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "image_claims_pkey" PRIMARY KEY ("userId","imageId")
);

-- CreateTable
CREATE TABLE "edit_detections" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "edit_type" "EditType" NOT NULL,
    "mask_url" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "suggestions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edit_detections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "image_claims_id_key" ON "image_claims"("id");

-- CreateIndex
CREATE INDEX "edit_detections_imageId_idx" ON "edit_detections"("imageId");

-- AddForeignKey
ALTER TABLE "image_claims" ADD CONSTRAINT "image_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_claims" ADD CONSTRAINT "image_claims_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edit_detections" ADD CONSTRAINT "edit_detections_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
