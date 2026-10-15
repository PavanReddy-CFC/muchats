-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "lastMessageAt" TIMESTAMP(3),
ADD COLUMN     "lastMessagePreview" TEXT;

-- CreateIndex
CREATE INDEX "channels_tenantId_lastMessageAt_idx" ON "channels"("tenantId", "lastMessageAt");
