// =============================================================================
// Typed errors mirroring `LegalEngagementEscrow.sol` reverts.
// -----------------------------------------------------------------------------
// Each error subclass has a stable `code` string matching the Solidity custom
// error name. Production swap-in: when the mock chain is replaced with viem
// `writeContract`, decoded revert data maps 1:1 onto these codes via
// `decodeErrorResult` against the contract's ABI. The HTTP boundary uses
// `chainErrorToHttp` to translate codes to status+JSON shapes the UI already
// understands.
// =============================================================================

export type ChainErrorCode =
  | "NotEngagementClient"
  | "NotEngagementLawyer"
  | "NotEngagementParty"
  | "NotVerifiedClient"
  | "NotVerifiedLawyer"
  | "CooldownNotElapsed"
  | "InvalidProposalState"
  | "InvalidEngagementState"
  | "ConflictProofFailed"
  | "NullifierAlreadyUsed"
  | "InvalidSplit"
  | "EthAmountMismatch"
  | "EngagementNotClean"
  | "OnlyOperator"
  | "InvalidRefundSignature"
  | "NonceAlreadyUsed"
  | "InvalidOfferSignature"
  | "NoSuchAttestation";

export class ChainError extends Error {
  public readonly code: ChainErrorCode;
  constructor(code: ChainErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "ChainError";
  }
}

export class NotEngagementClient extends ChainError {
  constructor(message?: string) {
    super("NotEngagementClient", message);
    this.name = "NotEngagementClient";
  }
}

export class NotEngagementLawyer extends ChainError {
  constructor(message?: string) {
    super("NotEngagementLawyer", message);
    this.name = "NotEngagementLawyer";
  }
}

export class NotEngagementParty extends ChainError {
  constructor(message?: string) {
    super("NotEngagementParty", message);
    this.name = "NotEngagementParty";
  }
}

export class NotVerifiedClient extends ChainError {
  constructor(message?: string) {
    super("NotVerifiedClient", message);
    this.name = "NotVerifiedClient";
  }
}

export class NotVerifiedLawyer extends ChainError {
  constructor(message?: string) {
    super("NotVerifiedLawyer", message);
    this.name = "NotVerifiedLawyer";
  }
}

/**
 * Thrown by `escalateProposal` if the lawyer attempts escalation before the
 * 30-day cooldown elapses. `unlockAt` is the absolute UTC timestamp when the
 * cooldown clears — surfaced to the UI so it can render an exact countdown.
 */
export class CooldownNotElapsed extends ChainError {
  public readonly unlockAt: Date;
  constructor(unlockAt: Date, message?: string) {
    super("CooldownNotElapsed", message ?? `Cooldown not elapsed until ${unlockAt.toISOString()}`);
    this.unlockAt = unlockAt;
    this.name = "CooldownNotElapsed";
  }
}

export class InvalidProposalState extends ChainError {
  constructor(message?: string) {
    super("InvalidProposalState", message);
    this.name = "InvalidProposalState";
  }
}

export class InvalidEngagementState extends ChainError {
  constructor(message?: string) {
    super("InvalidEngagementState", message);
    this.name = "InvalidEngagementState";
  }
}

export class ConflictProofFailed extends ChainError {
  constructor(message?: string) {
    super("ConflictProofFailed", message);
    this.name = "ConflictProofFailed";
  }
}

export class NullifierAlreadyUsed extends ChainError {
  constructor(message?: string) {
    super("NullifierAlreadyUsed", message);
    this.name = "NullifierAlreadyUsed";
  }
}

export class InvalidSplit extends ChainError {
  constructor(message?: string) {
    super("InvalidSplit", message);
    this.name = "InvalidSplit";
  }
}

export class EthAmountMismatch extends ChainError {
  constructor(message?: string) {
    super("EthAmountMismatch", message);
    this.name = "EthAmountMismatch";
  }
}

export class EngagementNotClean extends ChainError {
  constructor(message?: string) {
    super("EngagementNotClean", message);
    this.name = "EngagementNotClean";
  }
}

export class OnlyOperator extends ChainError {
  constructor(message?: string) {
    super("OnlyOperator", message);
    this.name = "OnlyOperator";
  }
}

export class InvalidRefundSignature extends ChainError {
  constructor(message?: string) {
    super("InvalidRefundSignature", message);
    this.name = "InvalidRefundSignature";
  }
}

export class NonceAlreadyUsed extends ChainError {
  constructor(message?: string) {
    super("NonceAlreadyUsed", message);
    this.name = "NonceAlreadyUsed";
  }
}

export class InvalidOfferSignature extends ChainError {
  constructor(message?: string) {
    super("InvalidOfferSignature", message);
    this.name = "InvalidOfferSignature";
  }
}

/**
 * Thrown by `revokeCapability` when the requested attestation UID isn't on
 * file. Mirrors `AttestationManager.NoSuchAttestation` (line 30 of the .sol).
 */
export class NoSuchAttestation extends ChainError {
  constructor(message?: string) {
    super("NoSuchAttestation", message);
    this.name = "NoSuchAttestation";
  }
}

export function isChainError(err: unknown): err is ChainError {
  return err instanceof ChainError;
}

/**
 * Map a chain error to an HTTP shape suitable for `NextResponse.json`. The
 * status codes are chosen to match how the existing API routes already
 * categorise failures: 401 for missing capability (auth-adjacent), 403 for
 * party-mismatch, 409 for state-transition conflicts, 422 for validation /
 * cryptographic-shape failures, 425 for cooldown.
 */
export function chainErrorToHttp(err: unknown): { status: number; body: { code: string; message: string; unlockAt?: string } } {
  if (!isChainError(err)) {
    return { status: 500, body: { code: "InternalError", message: err instanceof Error ? err.message : String(err) } };
  }
  switch (err.code) {
    case "NotVerifiedClient":
    case "NotVerifiedLawyer":
      return { status: 401, body: { code: err.code, message: err.message } };
    case "NotEngagementClient":
    case "NotEngagementLawyer":
    case "NotEngagementParty":
    case "OnlyOperator":
      return { status: 403, body: { code: err.code, message: err.message } };
    case "InvalidProposalState":
    case "InvalidEngagementState":
    case "EngagementNotClean":
    case "NullifierAlreadyUsed":
    case "NonceAlreadyUsed":
      return { status: 409, body: { code: err.code, message: err.message } };
    case "NoSuchAttestation":
      return { status: 404, body: { code: err.code, message: err.message } };
    case "CooldownNotElapsed": {
      const unlockAt = (err as CooldownNotElapsed).unlockAt;
      return { status: 425, body: { code: err.code, message: err.message, unlockAt: unlockAt.toISOString() } };
    }
    case "ConflictProofFailed":
    case "InvalidSplit":
    case "EthAmountMismatch":
    case "InvalidRefundSignature":
    case "InvalidOfferSignature":
      return { status: 422, body: { code: err.code, message: err.message } };
    default:
      return { status: 500, body: { code: err.code, message: err.message } };
  }
}
