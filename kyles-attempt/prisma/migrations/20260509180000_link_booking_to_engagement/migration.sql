-- F3: link Booking to its Engagement + Proposal (1:1).
--
-- Each booking now carries the on-chain engagementId of the Engagement it
-- opened, plus the proposalIndex of the consultation proposal inside that
-- Engagement (always 0 today; F4 introduces follow-ups as separate Proposal
-- rows). engagementId is nullable for legacy rows seeded before F3 and for
-- bookings whose chain-open failed.
--
-- deliveredAt mirrors Proposal.deliveredAt for fast lawyer-dashboard reads.

ALTER TABLE "Booking" ADD COLUMN "engagementId" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "proposalIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN "deliveredAt" DATETIME;

CREATE UNIQUE INDEX "Booking_engagementId_key" ON "Booking"("engagementId");
