-- F4: EIP-712-signed follow-up proposal offers.
--
-- Adds the ProposalOffer table that stores lawyer-signed offers awaiting
-- client funding, plus the back-link `Proposal.offerNonce` so we can map a
-- materialised proposal to the offer that minted it.
--
-- Also adds `User.devSignerAddress` — a dev-only mirror of the secp256k1
-- address derived from the deterministic seeded private key. Production
-- users leave this null and EIP-712 verification recovers to `walletAddress`
-- directly; seeded personas populate it so `0x1111…` / `0x2222…` style
-- placeholder addresses can still produce verifiable typed-data signatures.

-- 1. ProposalOffer model.
CREATE TABLE "ProposalOffer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "engagementId" INTEGER NOT NULL,
  "amountWei" TEXT NOT NULL,
  "itemsHash" TEXT NOT NULL,
  "itemsJson" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "lawyerSig" TEXT NOT NULL,
  "lawyerAddress" TEXT NOT NULL,
  "clientNote" TEXT,
  "consumedAt" DATETIME,
  "consumedTxHash" TEXT,
  "consumedProposalIndex" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ProposalOffer_nonce_key" ON "ProposalOffer"("nonce");
CREATE INDEX "ProposalOffer_engagementId_consumedAt_idx" ON "ProposalOffer"("engagementId", "consumedAt");

-- 2. Proposal.offerNonce — back-pointer to ProposalOffer.nonce.
ALTER TABLE "Proposal" ADD COLUMN "offerNonce" TEXT;

-- 3. User.devSignerAddress — dev-only persona signing key mirror.
ALTER TABLE "User" ADD COLUMN "devSignerAddress" TEXT;
