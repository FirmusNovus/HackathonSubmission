-- AlterTable
ALTER TABLE "LawyerProfile" ADD COLUMN "capabilityUid" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "clientCapabilityUid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LawyerProfile_capabilityUid_key" ON "LawyerProfile"("capabilityUid");

-- CreateIndex
CREATE UNIQUE INDEX "User_clientCapabilityUid_key" ON "User"("clientCapabilityUid");
