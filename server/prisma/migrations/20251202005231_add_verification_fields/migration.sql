-- AlterTable
ALTER TABLE "users" ADD COLUMN "verification_token" TEXT,
ADD COLUMN "verification_token_expires_at" TIMESTAMP(3),
ADD COLUMN "google_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_verification_token_key" ON "users"("verification_token");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

