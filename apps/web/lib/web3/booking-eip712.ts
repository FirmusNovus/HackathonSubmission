// EIP-712 typed-data definition for a client's booking request.
//
// The client signs this typed structure with their wallet at booking time —
// proving they authorised THIS specific booking (lawyer + scheduled time +
// duration + fee + case description hash), not just that they're logged in.
// The server recovers the signing address and rejects anything that doesn't
// match the SIWE-bound wallet on the session.
//
// Domain notes:
// - chainId pins the signature to the chain we expect to fund the engagement on.
// - verifyingContract is the LegalEngagementEscrow address — same one the
//   later openEngagementAndFundFirstMilestone tx will hit, so the user's
//   wallet shows the same contract context for both signatures.

import { keccak256, stringToBytes, type Address, type Hex } from "viem";

export const BOOKING_DOMAIN_NAME = "FirmusNovus";
export const BOOKING_DOMAIN_VERSION = "1";

export const BOOKING_TYPES = {
  BookingRequest: [
    { name: "client", type: "address" },
    { name: "lawyerProfileId", type: "string" },
    { name: "scheduledAtUnix", type: "uint256" },
    { name: "durationMinutes", type: "uint256" },
    { name: "consultationFeeWei", type: "uint256" },
    { name: "practiceArea", type: "string" },
    { name: "caseDescriptionHash", type: "bytes32" },
    { name: "nonce", type: "string" },
  ],
} as const;

export const BOOKING_ACCEPT_TYPES = {
  BookingAccept: [
    { name: "lawyer", type: "address" },
    { name: "bookingId", type: "string" },
    { name: "consultationFeeWei", type: "uint256" },
    { name: "scheduledAtUnix", type: "uint256" },
    { name: "nonce", type: "string" },
  ],
} as const;

export interface BookingRequestPayload {
  client: Address;
  lawyerProfileId: string;
  scheduledAtUnix: bigint;
  durationMinutes: bigint;
  consultationFeeWei: bigint;
  practiceArea: string;
  caseDescriptionHash: Hex;
  nonce: string;
}

export interface BookingAcceptPayload {
  lawyer: Address;
  bookingId: string;
  consultationFeeWei: bigint;
  scheduledAtUnix: bigint;
  nonce: string;
}

export function buildBookingDomain(args: {
  chainId: number;
  verifyingContract: Address;
}): {
  name: typeof BOOKING_DOMAIN_NAME;
  version: typeof BOOKING_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: Address;
} {
  return {
    name: BOOKING_DOMAIN_NAME,
    version: BOOKING_DOMAIN_VERSION,
    chainId: args.chainId,
    verifyingContract: args.verifyingContract,
  };
}

/**
 * Hash a case description so it goes into the typed-data as a fixed-size
 * field (bytes32). Avoids signing arbitrarily-large strings while still
 * binding the signature to the exact text the user sent.
 */
export function hashCaseDescription(description: string): Hex {
  return keccak256(stringToBytes(description));
}

/**
 * Generate a fresh nonce for a single booking request. The server stores
 * this on the Booking row alongside the signature; replays land on a unique
 * row constraint at the schema level (Booking.id is the cuid; nonce is just
 * one more way to make the typed-data unique per request).
 */
export function generateBookingNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
