-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "clientRefundSignature" TEXT;
ALTER TABLE "Booking" ADD COLUMN "escrowRefundHash" TEXT;
ALTER TABLE "Booking" ADD COLUMN "lawyerRefundSignature" TEXT;
ALTER TABLE "Booking" ADD COLUMN "refundProposedAt" DATETIME;
ALTER TABLE "Booking" ADD COLUMN "refundProposedBy" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "clientRefundSignature" TEXT;
ALTER TABLE "Order" ADD COLUMN "escrowRefundHash" TEXT;
ALTER TABLE "Order" ADD COLUMN "lawyerRefundSignature" TEXT;
ALTER TABLE "Order" ADD COLUMN "refundProposedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "refundProposedBy" TEXT;
