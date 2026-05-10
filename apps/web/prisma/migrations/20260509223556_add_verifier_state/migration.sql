-- CreateTable
CREATE TABLE "VerifierState" (
    "state" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "requestJws" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verifiedAttrs" TEXT,
    "holderJwk" TEXT,
    "rejectedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);
