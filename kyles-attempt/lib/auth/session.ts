import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { Role } from "@/lib/db/enums";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { hasVerifiedCapability, isOperator } from "@/lib/auth/capability";
import { SCHEMA_CLIENT, SCHEMA_LAWYER } from "@/lib/chain/schemas";

export async function requireSession() {
  const session = await auth();
  if (!session?.user) redirect("/connect");
  return session;
}

/**
 * Gate for client-only routes. Two checks, in order:
 *
 *   1. The session role is CLIENT (else send to the lawyer dashboard — the
 *      user picked the wrong role on sign-in).
 *   2. The wallet has an active SCHEMA_CLIENT capability. Without it, the
 *      booking flow can't fund escrow (the chain would revert NotVerifiedClient).
 *      We bounce them back to /connect so the age-verification step mints
 *      the capability before they try to book.
 */
export async function requireClient() {
  const session = await requireSession();
  if (session.user.role !== Role.CLIENT) redirect("/lawyer/dashboard");
  const ok = await hasVerifiedCapability(session.user.walletAddress, SCHEMA_CLIENT);
  if (!ok) redirect("/connect");
  return session;
}

/**
 * Gate for lawyer-only routes. Two checks:
 *
 *   1. The session role is LAWYER (else send to /client/home).
 *   2. The wallet has an active SCHEMA_LAWYER capability. Without it the
 *      lawyer is either still in PENDING (no capability minted yet) or got
 *      REVOKED mid-session — either way they go to /verify-lawyer where the
 *      F2 flow either auto-mints (dev) or shows the "awaiting EBSI" state.
 */
export async function requireLawyer() {
  const session = await requireSession();
  if (session.user.role !== Role.LAWYER) redirect("/client/home");
  const ok = await hasVerifiedCapability(session.user.walletAddress, SCHEMA_LAWYER);
  if (!ok) redirect("/verify-lawyer");
  return session;
}

/**
 * Lighter gate used by `/verify-lawyer` itself — checks role only, no
 * capability lookup. Without this the capability gate in `requireLawyer`
 * would redirect a not-yet-verified lawyer FROM /verify-lawyer TO
 * /verify-lawyer in an infinite loop.
 *
 * Also used by routes that must remain reachable to a REVOKED lawyer for
 * an existing in-flight Booking — see `requireLawyerForExistingBooking`
 * below. Per the AttestationManager + LegalEngagementEscrow contracts
 * (`onlyVerifiedClient` only fires on `openEngagement*`; in-flight state
 * transitions check engagement-party identity, not capability), revoking
 * a lawyer's SCHEMA_LAWYER capability must hide them from discovery and
 * block NEW bookings — but it must NOT lock them out of consultations or
 * message threads they're already a party to.
 */
export async function requireLawyerRoleOnly() {
  const session = await requireSession();
  if (session.user.role !== Role.LAWYER) redirect("/client/home");
  return session;
}

/**
 * Gate for lawyer pages that are tied to an existing engagement (the
 * consultation room, the inbox of message threads attached to a Booking).
 * Role-only — capability is intentionally NOT checked, mirroring the
 * contract semantic that an in-flight engagement survives a revoke. Caller
 * still needs to verify the booking/conversation belongs to the lawyer.
 */
export async function requireLawyerForExistingBooking() {
  const session = await requireSession();
  if (session.user.role !== Role.LAWYER) redirect("/client/home");
  return session;
}

/**
 * Gate for operator-only routes. Mirrors A's pattern of identifying the
 * attestor by the wallet itself: either the wallet matches the configured
 * operator address (env-key fallback used by the dev seed) OR it carries an
 * active SCHEMA_OPERATOR capability. Operator role isn't fully wired until
 * F7 — this helper is the placeholder seam.
 */
export async function requireOperator() {
  const session = await requireSession();
  const ok = await isOperator(session.user.walletAddress);
  if (!ok) redirect("/");
  return session;
}

/**
 * Resolve the *current* User row by walletAddress (the stable identifier),
 * not the JWT's cuid. Use this in any Node-runtime handler that writes
 * foreign-key references to the user — the JWT can carry a stale id after a
 * DB reseed. Returns null if no session or the wallet has no user row.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  const wallet = session?.user?.walletAddress;
  if (!wallet) return null;
  return prisma.user.findUnique({ where: { walletAddress: wallet } });
}
