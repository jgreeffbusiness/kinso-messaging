-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "Contact_userId_status_idx" ON "Contact"("userId", "status");
