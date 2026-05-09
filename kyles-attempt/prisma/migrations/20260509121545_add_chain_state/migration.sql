-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" INTEGER NOT NULL,
    "clientUserId" TEXT NOT NULL,
    "lawyerUserId" TEXT NOT NULL,
    "matterRef" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "transcriptRoot" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000',
    "proposalCount" INTEGER NOT NULL DEFAULT 0,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "openTxHash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementInternalId" TEXT NOT NULL,
    "engagementId" INTEGER NOT NULL,
    "proposalIndex" INTEGER NOT NULL,
    "amountWei" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'FUNDED',
    "deliveredAt" DATETIME,
    "amountToLawyerWei" TEXT,
    "amountToClientWei" TEXT,
    "itemsHash" TEXT,
    "nonce" TEXT,
    "lawyerOfferSig" TEXT,
    "fundTxHash" TEXT NOT NULL,
    "deliverTxHash" TEXT,
    "releaseTxHash" TEXT,
    "disputeTxHash" TEXT,
    "resolveTxHash" TEXT,
    "refundTxHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Proposal_engagementInternalId_fkey" FOREIGN KEY ("engagementInternalId") REFERENCES "Engagement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Capability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectAddress" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "attestationUid" TEXT NOT NULL,
    "claims" TEXT NOT NULL DEFAULT '{}',
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "expiresAt" DATETIME
);

-- CreateTable
CREATE TABLE "UsedNullifier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nullifier" TEXT NOT NULL,
    "engagementId" INTEGER NOT NULL,
    "usedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConsumedProposalNonce" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nonce" TEXT NOT NULL,
    "engagementId" INTEGER NOT NULL,
    "proposalIndex" INTEGER NOT NULL,
    "consumedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LawyerConflictRoot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lawyerAddress" TEXT NOT NULL,
    "root" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MutualRefundAuth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" INTEGER NOT NULL,
    "proposalIndex" INTEGER NOT NULL,
    "clientSig" TEXT NOT NULL,
    "lawyerSig" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" INTEGER,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TranscriptRootHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engagementId" INTEGER NOT NULL,
    "root" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "anchoredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MockChainCounter" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "nextBlock" INTEGER NOT NULL DEFAULT 1,
    "nextEngagement" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MockClock" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "offsetSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_engagementId_key" ON "Engagement"("engagementId");

-- CreateIndex
CREATE INDEX "Engagement_clientUserId_idx" ON "Engagement"("clientUserId");

-- CreateIndex
CREATE INDEX "Engagement_lawyerUserId_idx" ON "Engagement"("lawyerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_engagementId_proposalIndex_key" ON "Proposal"("engagementId", "proposalIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Capability_attestationUid_key" ON "Capability"("attestationUid");

-- CreateIndex
CREATE INDEX "Capability_subjectAddress_schemaId_revokedAt_idx" ON "Capability"("subjectAddress", "schemaId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsedNullifier_nullifier_key" ON "UsedNullifier"("nullifier");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedProposalNonce_nonce_key" ON "ConsumedProposalNonce"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "LawyerConflictRoot_lawyerAddress_key" ON "LawyerConflictRoot"("lawyerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "MutualRefundAuth_engagementId_proposalIndex_key" ON "MutualRefundAuth"("engagementId", "proposalIndex");

-- CreateIndex
CREATE INDEX "ChainEvent_engagementId_blockNumber_idx" ON "ChainEvent"("engagementId", "blockNumber");

-- CreateIndex
CREATE INDEX "TranscriptRootHistory_engagementId_blockNumber_idx" ON "TranscriptRootHistory"("engagementId", "blockNumber");
