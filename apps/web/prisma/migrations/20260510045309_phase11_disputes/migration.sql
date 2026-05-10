-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "disputeAmountToClient" DECIMAL;
ALTER TABLE "Booking" ADD COLUMN "disputeAmountToLawyer" DECIMAL;
ALTER TABLE "Booking" ADD COLUMN "disputeOpenTxHash" TEXT;
ALTER TABLE "Booking" ADD COLUMN "disputeOpenedBy" TEXT;
ALTER TABLE "Booking" ADD COLUMN "disputeResolveTxHash" TEXT;
ALTER TABLE "Booking" ADD COLUMN "disputeResolvedAt" DATETIME;
ALTER TABLE "Booking" ADD COLUMN "disputedAt" DATETIME;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "disputeAmountToClient" DECIMAL;
ALTER TABLE "Order" ADD COLUMN "disputeAmountToLawyer" DECIMAL;
ALTER TABLE "Order" ADD COLUMN "disputeOpenTxHash" TEXT;
ALTER TABLE "Order" ADD COLUMN "disputeOpenedBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "disputeResolveTxHash" TEXT;
ALTER TABLE "Order" ADD COLUMN "disputeResolvedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "disputedAt" DATETIME;

-- CreateTable
CREATE TABLE "DisputeArchive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT,
    "orderId" TEXT,
    "submittedById" TEXT NOT NULL,
    "submitterEncryptionPublicKey" TEXT NOT NULL,
    "encryptedBundle" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisputeArchive_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DisputeArchive_bookingId_idx" ON "DisputeArchive"("bookingId");

-- CreateIndex
CREATE INDEX "DisputeArchive_orderId_idx" ON "DisputeArchive"("orderId");
