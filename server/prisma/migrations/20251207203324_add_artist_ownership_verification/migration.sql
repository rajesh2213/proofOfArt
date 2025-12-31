-- AlterEnum
ALTER TYPE "ClaimStatus" ADD VALUE 'APPROVED';

-- CreateTable
CREATE TABLE "artworks" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "original_uploader_id" TEXT NOT NULL,
    "current_owner_id" TEXT NOT NULL,
    "embedded_proof" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artwork_claims" (
    "id" TEXT NOT NULL,
    "artwork_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artwork_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_history" (
    "id" TEXT NOT NULL,
    "artwork_id" TEXT NOT NULL,
    "previous_owner_id" TEXT,
    "new_owner_id" TEXT NOT NULL,
    "transfer_type" TEXT NOT NULL,
    "claim_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "artwork_id" TEXT,
    "claim_id" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "artworks_imageId_key" ON "artworks"("imageId");

-- CreateIndex
CREATE INDEX "artworks_original_uploader_id_idx" ON "artworks"("original_uploader_id");

-- CreateIndex
CREATE INDEX "artworks_current_owner_id_idx" ON "artworks"("current_owner_id");

-- CreateIndex
CREATE INDEX "artworks_imageId_idx" ON "artworks"("imageId");

-- CreateIndex
CREATE INDEX "artwork_claims_artwork_id_idx" ON "artwork_claims"("artwork_id");

-- CreateIndex
CREATE INDEX "artwork_claims_requester_id_idx" ON "artwork_claims"("requester_id");

-- CreateIndex
CREATE INDEX "artwork_claims_status_idx" ON "artwork_claims"("status");

-- CreateIndex
CREATE INDEX "ownership_history_artwork_id_idx" ON "ownership_history"("artwork_id");

-- CreateIndex
CREATE INDEX "ownership_history_new_owner_id_idx" ON "ownership_history"("new_owner_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_read_idx" ON "notifications"("read");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- AddForeignKey
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_original_uploader_id_fkey" FOREIGN KEY ("original_uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_current_owner_id_fkey" FOREIGN KEY ("current_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_claims" ADD CONSTRAINT "artwork_claims_artwork_id_fkey" FOREIGN KEY ("artwork_id") REFERENCES "artworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_claims" ADD CONSTRAINT "artwork_claims_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_claims" ADD CONSTRAINT "artwork_claims_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_artwork_id_fkey" FOREIGN KEY ("artwork_id") REFERENCES "artworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_new_owner_id_fkey" FOREIGN KEY ("new_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
