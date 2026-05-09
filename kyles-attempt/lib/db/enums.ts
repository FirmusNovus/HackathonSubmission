// SQLite-via-Prisma drops native enum support, so the enum columns are stored
// as plain strings in `LawyerProfile`, `Booking`, and `User`. These const
// objects (+ string-union types) are the TypeScript-side replacement for the
// `@prisma/client` enum exports — same identifier, same call sites.

export const Role = {
  CLIENT: "CLIENT",
  LAWYER: "LAWYER",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

// REVOKED is the F2 addition — set when the operator revokes a previously
// minted SCHEMA_LAWYER capability. The lawyer becomes invisible in the
// directory and on profile pages, and any new booking attempt against them
// 409s with NotVerifiedLawyer. Existing in-flight engagements/bookings are
// untouched (mirrors the EAS contract semantic — revoke flips capability,
// it doesn't roll back state).
export const VerificationStatus = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
  REVOKED: "REVOKED",
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

// F3: DELIVERED added — the lawyer has marked the consultation as deliverable
// (`markDelivered` on Proposal[0]) and the client now needs to release escrow.
// Maps directly to PROPOSAL_STATE.DELIVERED on the chain mirror.
export const BookingStatus = {
  REQUESTED: "REQUESTED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  IN_PROGRESS: "IN_PROGRESS",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  DISPUTED: "DISPUTED",
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const PricingKind = {
  HOURLY: "HOURLY",
  FIXED: "FIXED",
  SUBSCRIPTION: "SUBSCRIPTION",
  SUCCESS: "SUCCESS",
} as const;
export type PricingKind = (typeof PricingKind)[keyof typeof PricingKind];
