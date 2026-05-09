// =============================================================================
// Capability schema identifiers.
// -----------------------------------------------------------------------------
// Re-exports of the three schema-id constants from `lib/chain/escrow.ts`,
// pulled out into their own module so route handlers and React server
// components can import them without dragging the entire chain layer (and
// its Prisma transactions) into a route bundle.
//
// The schema-id strings themselves match the Solidity registry IDs in
// `AttestationManager.sol` (constructor: `_schemaRegistry.register(...)`).
// We keep the same triplet — SCHEMA_LAWYER / SCHEMA_CLIENT / SCHEMA_OPERATOR —
// even though A's `AttestationManager` only registers LAWYER + CLIENT +
// ARBITER. The "operator" capability is the off-chain seam used by the
// platform to identify the attestor wallet itself; F7 may rename it back to
// ARBITER once that role is fully wired.
// =============================================================================

export const SCHEMA_LAWYER = "SCHEMA_LAWYER" as const;
export const SCHEMA_CLIENT = "SCHEMA_CLIENT" as const;
export const SCHEMA_OPERATOR = "SCHEMA_OPERATOR" as const;
export type SchemaId = typeof SCHEMA_LAWYER | typeof SCHEMA_CLIENT | typeof SCHEMA_OPERATOR;

/**
 * Mirror of the Lawyer schema fields encoded in
 * `AttestationManager.sol` lines 17–21:
 *
 *   string jurisdiction,
 *   string barAdmissionNumber,
 *   uint64 admittedAt,
 *   uint64 validUntil
 *
 * Persisted as JSON in `Capability.claims`. We carry ISO-8601 datetimes
 * here (rather than uint64 unix seconds) since the storage path is JSON,
 * not abi.encode — F4 will translate to seconds when minting on-chain.
 *
 * `givenName` / `familyName` are off-chain conveniences from the bar VC's
 * `given_name` / `family_name` fields (see A's lawyer finalize route). They
 * are NOT part of the on-chain schema; we keep them in the JSON blob purely
 * for UI rendering.
 */
export type LawyerClaims = {
  jurisdiction: string;
  barAdmissionNumber: string;
  admittedAt: string; // ISO datetime
  validUntil: string | null; // ISO datetime, or null = unlimited
  givenName?: string;
  familyName?: string;
};

/**
 * Mirror of the Client schema fields:
 *
 *   string countryOfResidence,
 *   bool   ageOver18
 */
export type ClientClaims = {
  countryOfResidence: string;
  ageOver18: boolean;
};

/**
 * Operator schema is a thin marker — A's `attestVerifiedArbiter` carries
 * a free-form `note`. We keep the same shape so the JSON is round-trippable.
 */
export type OperatorClaims = {
  note: string;
};
