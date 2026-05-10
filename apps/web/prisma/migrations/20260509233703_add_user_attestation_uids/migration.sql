-- AlterTable
ALTER TABLE "User" ADD COLUMN "attestedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "clientAttestationUid" TEXT;
ALTER TABLE "User" ADD COLUMN "lawyerAttestationUid" TEXT;
