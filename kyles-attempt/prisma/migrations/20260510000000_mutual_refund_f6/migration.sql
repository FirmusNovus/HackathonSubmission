-- F6: mutual-refund request flow + nullable MutualRefundAuth.nonce.
--
-- 1. Make MutualRefundAuth.nonce nullable. A's EIP-712 MUTUAL_REFUND_TYPEHASH
--    does NOT include a nonce — replay safety comes from the Funded →
--    Refunded state-machine transition. We keep the column for backward-
--    compat with rows minted before F6, but new rows leave it null.
--
-- 2. Add the MutualRefundRequest table that collects both parties' sigs
--    before submission to chain. Status: PENDING → SIGNED_BOTH → SUBMITTED
--    (or REJECTED at any point).
--
-- SQLite has no `ALTER COLUMN` — making `nonce` nullable requires a
-- table-rebuild dance. We copy data into a temp table, drop the original,
-- and re-create with the new schema, then re-create indexes.

PRAGMA foreign_keys=OFF;

-- 1. MutualRefundAuth.nonce → nullable.
CREATE TABLE "new_MutualRefundAuth" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "engagementId" INTEGER NOT NULL,
  "proposalIndex" INTEGER NOT NULL,
  "clientSig" TEXT NOT NULL,
  "lawyerSig" TEXT NOT NULL,
  "nonce" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_MutualRefundAuth" ("id", "engagementId", "proposalIndex", "clientSig", "lawyerSig", "nonce", "createdAt")
SELECT "id", "engagementId", "proposalIndex", "clientSig", "lawyerSig", "nonce", "createdAt"
FROM "MutualRefundAuth";
DROP TABLE "MutualRefundAuth";
ALTER TABLE "new_MutualRefundAuth" RENAME TO "MutualRefundAuth";
CREATE UNIQUE INDEX "MutualRefundAuth_engagementId_proposalIndex_key"
  ON "MutualRefundAuth"("engagementId", "proposalIndex");

-- 2. MutualRefundRequest.
CREATE TABLE "MutualRefundRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "engagementId" INTEGER NOT NULL,
  "proposalIndex" INTEGER NOT NULL,
  "initiatedBy" TEXT NOT NULL,
  "clientSig" TEXT,
  "lawyerSig" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "submittedAt" DATETIME,
  "submitTxHash" TEXT
);
CREATE INDEX "MutualRefundRequest_engagementId_proposalIndex_status_idx"
  ON "MutualRefundRequest"("engagementId", "proposalIndex", "status");

PRAGMA foreign_keys=ON;
