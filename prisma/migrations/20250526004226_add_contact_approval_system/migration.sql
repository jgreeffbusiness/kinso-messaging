/*
  Warnings:

  - You are about to drop the column `uid` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[googleContactId]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[googleId]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[authId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Contact` table without a default value. This is not possible if the table is not empty.
  - Added the required column `platformMessageId` to the `Message` table without a default value. This is not possible if the table is not empty.
  - Added the required column `authId` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "User_email_key";

-- DropIndex
DROP INDEX "User_uid_key";

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "googleContactId" TEXT,
ADD COLUMN     "googleId" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "platformData" JSONB,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "platformData" JSONB,
ADD COLUMN     "platformMessageId" TEXT NOT NULL,
ADD COLUMN     "readAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" DROP COLUMN "uid",
ADD COLUMN     "authId" TEXT NOT NULL,
ADD COLUMN     "authProvider" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "googleAccessToken" TEXT,
ADD COLUMN     "googleIntegrations" JSONB,
ADD COLUMN     "googleRefreshToken" TEXT,
ADD COLUMN     "googleTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "name" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "slackAccessToken" TEXT,
ADD COLUMN     "slackIntegrations" JSONB,
ADD COLUMN     "slackRefreshToken" TEXT,
ADD COLUMN     "slackTeamId" TEXT,
ADD COLUMN     "slackTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "slackUserId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingContactApproval" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT,
    "senderHandle" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 1,
    "firstMessageDate" TIMESTAMP(3) NOT NULL,
    "lastMessageDate" TIMESTAMP(3) NOT NULL,
    "previewContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingContactApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingMessage" (
    "id" TEXT NOT NULL,
    "pendingApprovalId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "platformMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlacklistedSender" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "senderName" TEXT,
    "senderEmail" TEXT,
    "senderHandle" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlacklistedSender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMessage_userId_idx" ON "ContactMessage"("userId");

-- CreateIndex
CREATE INDEX "ContactMessage_contactId_idx" ON "ContactMessage"("contactId");

-- CreateIndex
CREATE INDEX "ContactMessage_threadId_idx" ON "ContactMessage"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactMessage_messageId_contactId_key" ON "ContactMessage"("messageId", "contactId");

-- CreateIndex
CREATE INDEX "Note_contactId_idx" ON "Note"("contactId");

-- CreateIndex
CREATE INDEX "Note_userId_idx" ON "Note"("userId");

-- CreateIndex
CREATE INDEX "PendingContactApproval_userId_idx" ON "PendingContactApproval"("userId");

-- CreateIndex
CREATE INDEX "PendingContactApproval_platform_idx" ON "PendingContactApproval"("platform");

-- CreateIndex
CREATE INDEX "PendingMessage_pendingApprovalId_idx" ON "PendingMessage"("pendingApprovalId");

-- CreateIndex
CREATE INDEX "BlacklistedSender_userId_idx" ON "BlacklistedSender"("userId");

-- CreateIndex
CREATE INDEX "BlacklistedSender_platform_idx" ON "BlacklistedSender"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "BlacklistedSender_userId_platform_senderEmail_key" ON "BlacklistedSender"("userId", "platform", "senderEmail");

-- CreateIndex
CREATE UNIQUE INDEX "BlacklistedSender_userId_platform_senderHandle_key" ON "BlacklistedSender"("userId", "platform", "senderHandle");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_googleContactId_key" ON "Contact"("googleContactId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_googleId_key" ON "Contact"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_authId_key" ON "User"("authId");

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingContactApproval" ADD CONSTRAINT "PendingContactApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingMessage" ADD CONSTRAINT "PendingMessage_pendingApprovalId_fkey" FOREIGN KEY ("pendingApprovalId") REFERENCES "PendingContactApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlacklistedSender" ADD CONSTRAINT "BlacklistedSender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
