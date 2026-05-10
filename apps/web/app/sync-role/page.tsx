import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getAttestationStatus } from "@/lib/chain/attestations";
import { SyncRoleClient } from "./sync-role-client";

/**
 * Self-heals a JWT whose `role` has fallen out of sync with the on-chain
 * attestation set. Reads the wallet + chain attestations server-side, then
 * hands the desired role to a tiny client component that calls
 * `useSession().update({ role })` and navigates onward. This replaces the
 * older signout-confirmation redirect that briefly showed a "logout?" page
 * mid-flow.
 *
 * Edge case: if the chain itself disagrees with the cookie (e.g. wallet has
 * no attestations but the JWT is from an old engagement), we sign out — that
 * really is the correct path.
 */
export default async function SyncRolePage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const session = await auth();
  const wallet = session?.user?.walletAddress;
  if (!wallet) redirect("/");

  const sp = await searchParams;
  const to = typeof sp.to === "string" && sp.to.startsWith("/") ? sp.to : "/";

  const status = await getAttestationStatus(wallet);
  if (!status.client && !status.lawyer) {
    // No attestations at all — JWT is genuinely orphaned. Sign out cleanly.
    redirect("/api/auth/signout?callbackUrl=/");
  }
  const desiredRole = status.lawyer ? "LAWYER" : "CLIENT";

  // Already in sync? Skip the round-trip.
  if (session.user.role === desiredRole) {
    redirect(to);
  }

  return <SyncRoleClient desiredRole={desiredRole} to={to} />;
}
