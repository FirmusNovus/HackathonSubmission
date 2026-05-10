-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "lawyerAcceptNonce" TEXT;
ALTER TABLE "Booking" ADD COLUMN "lawyerAcceptSignature" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "lawyerCreateNonce" TEXT;
ALTER TABLE "Order" ADD COLUMN "lawyerCreateSignature" TEXT;
