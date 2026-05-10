// SQLite has no native enum support, so the schema stores these as plain
// strings. These const objects + types preserve the `Role.CLIENT` ergonomics
// the codebase had while using `enum Role` from `@prisma/client`.

export const Role = {
  CLIENT: "CLIENT",
  LAWYER: "LAWYER",
  // The platform operator. Mints attestations on chain, resolves disputes
  // via the escrow contract's `resolveDispute(...)`, and (in production)
  // would be replaced by a separated arbiter pool. Detected at SIWE-time
  // by matching the connecting wallet against operatorAddress() — the
  // operator never goes through PID/bar onboarding.
  OPERATOR: "OPERATOR",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const VerificationStatus = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const BookingStatus = {
  REQUESTED: "REQUESTED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  IN_PROGRESS: "IN_PROGRESS",
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
