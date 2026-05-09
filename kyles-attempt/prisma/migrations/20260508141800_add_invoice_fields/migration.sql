-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "clientAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "deliverables" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "lawyerAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "lineItems" JSONB NOT NULL DEFAULT '[]';
