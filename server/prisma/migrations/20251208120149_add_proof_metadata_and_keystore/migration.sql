-- AlterTable
ALTER TABLE "artworks" ADD COLUMN     "proof_metadata" JSONB;

-- CreateTable
CREATE TABLE "key_store" (
    "id" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "public_key_pem" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "key_store_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "key_store_kid_key" ON "key_store"("kid");

-- CreateIndex
CREATE INDEX "key_store_kid_idx" ON "key_store"("kid");

-- CreateIndex
CREATE INDEX "key_store_owner_type_owner_id_idx" ON "key_store"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "key_store_revoked_idx" ON "key_store"("revoked");
