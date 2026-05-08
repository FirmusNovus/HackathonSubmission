// Owner spec: 001-verified-legal-engagement.
// Translates contract custom errors into stable API error codes. The chain is
// the arbiter of state mutations (FR-058); the platform's job is to surface
// "state changed — please reload" instead of a generic 500 (FR-059).

const REVERT_TO_CODE: Array<{ pattern: RegExp; code: string; status: number }> = [
  { pattern: /CooldownNotElapsed/, code: 'cooldown-not-elapsed', status: 409 },
  { pattern: /InvalidProposalState/, code: 'invalid-proposal-state', status: 409 },
  { pattern: /InvalidEngagementState/, code: 'invalid-engagement-state', status: 409 },
  { pattern: /NotVerifiedClient/, code: 'not-verified-client', status: 403 },
  { pattern: /NotVerifiedLawyer/, code: 'not-verified-lawyer', status: 403 },
  { pattern: /NotEngagementClient/, code: 'not-engagement-client', status: 403 },
  { pattern: /NotEngagementLawyer/, code: 'not-engagement-lawyer', status: 403 },
  { pattern: /NotEngagementParty/, code: 'not-engagement-party', status: 403 },
  { pattern: /OnlyOperator/, code: 'only-operator', status: 403 },
  { pattern: /NullifierAlreadyUsed/, code: 'conflict-nullifier-replay', status: 409 },
  { pattern: /NonceAlreadyUsed/, code: 'nonce-replay', status: 409 },
  { pattern: /InvalidSplit/, code: 'invalid-split', status: 400 },
  { pattern: /EthAmountMismatch/, code: 'eth-amount-mismatch', status: 400 },
  { pattern: /EngagementNotClean/, code: 'engagement-not-clean', status: 409 },
  { pattern: /TransferFailed/, code: 'transfer-failed', status: 500 },
  { pattern: /InvalidRefundSignature/, code: 'invalid-refund-signature', status: 400 },
  { pattern: /InvalidOfferSignature/, code: 'invalid-offer-signature', status: 400 },
  { pattern: /ConflictProofFailed/, code: 'conflict-proof-failed', status: 400 },
];

export interface RevertInfo {
  code: string;
  status: number;
  detail: string;
}

/** Map a viem contract-revert error message to a stable error code. */
export function classifyRevert(error: unknown): RevertInfo {
  const msg = error instanceof Error ? error.message : String(error);
  for (const { pattern, code, status } of REVERT_TO_CODE) {
    if (pattern.test(msg)) return { code, status, detail: msg.slice(0, 200) };
  }
  return { code: 'broadcast-failed', status: 500, detail: msg.slice(0, 200) };
}
