/*
  Warnings:

  - You are about to drop the column `userId` on the `images` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."images" DROP CONSTRAINT "images_userId_fkey";

-- DropIndex
DROP INDEX "public"."images_userId_idx";

-- AlterTable
ALTER TABLE "images" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "username" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "_ImageToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ImageToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ImageToUser_B_index" ON "_ImageToUser"("B");

-- AddForeignKey
ALTER TABLE "_ImageToUser" ADD CONSTRAINT "_ImageToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ImageToUser" ADD CONSTRAINT "_ImageToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
