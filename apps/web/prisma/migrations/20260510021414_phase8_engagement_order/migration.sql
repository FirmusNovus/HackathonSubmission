/*
  Warnings:

  - You are about to drop the column `deliverables` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `lineItems` on the `Booking` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "lawyerProfileId" TEXT NOT NULL,
    "matterRef" TEXT NOT NULL,
    "engagementIdOnChain" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "Engagement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Engagement_lawyerProfileId_fkey" FOREIGN KEY ("lawyerProfileId") REFERENCES "LawyerProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountETH" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "milestoneIndex" INTEGER,
    "escrowTxHash" TEXT,
    "escrowReleaseHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "lawyerProfileId" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "clientAcceptedAt" DATETIME,
    "lawyerAcceptedAt" DATETIME,
    "consultationFeeEUR" DECIMAL NOT NULL,
    "platformFeeEUR" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "caseDescription" TEXT NOT NULL,
    "practiceArea" TEXT NOT NULL,
    "escrowTxHash" TEXT,
    "escrowReleaseHash" TEXT,
    "engagementId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_lawyerProfileId_fkey" FOREIGN KEY ("lawyerProfileId") REFERENCES "LawyerProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("caseDescription", "clientAcceptedAt", "clientId", "consultationFeeEUR", "createdAt", "durationMinutes", "engagementId", "escrowReleaseHash", "escrowTxHash", "id", "lawyerAcceptedAt", "lawyerProfileId", "notes", "platformFeeEUR", "practiceArea", "scheduledAt", "status", "updatedAt") SELECT "caseDescription", "clientAcceptedAt", "clientId", "consultationFeeEUR", "createdAt", "durationMinutes", "engagementId", "escrowReleaseHash", "escrowTxHash", "id", "lawyerAcceptedAt", "lawyerProfileId", "notes", "platformFeeEUR", "practiceArea", "scheduledAt", "status", "updatedAt" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_engagementId_key" ON "Booking"("engagementId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_matterRef_key" ON "Engagement"("matterRef");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_engagementIdOnChain_key" ON "Engagement"("engagementIdOnChain");
