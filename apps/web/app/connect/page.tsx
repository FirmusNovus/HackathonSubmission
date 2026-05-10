import { redirect } from "next/navigation";

import { AuthShell } from "@/components/layout/auth-shell";
import { auth } from "@/lib/auth/config";
import { getAttestationStatus } from "@/lib/chain/attestations";
import { ConnectFlow } from "./connect-flow";

/**
 * The onboarding entry point. Three cases:
 *
 *   1. Anonymous viewer → bounced to / where the WalletButton runs the inline
 *      connect+SIWE flow. Without a session there's nothing /connect can do.
 *   2. Signed-in user already attested on chain → redirect straight to their
 *      dashboard. They've finished onboarding; this page would be a dead-end.
 *   3. Signed-in user with no attestations → render <ConnectFlow>, which now
 *      starts at the role-pick stage (the wallet stage moved to WalletButton).
 */
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const session = await auth();
  const wallet = session?.user?.walletAddress;

  if (!wallet) {
    redirect("/");
  }

  // Operator wallet doesn't go through PID/bar onboarding; bounce them
  // straight to the admin dashboard.
  if (session.user.role === "OPERATOR") {
    redirect("/admin/dashboard");
  }

  // Only redirect for the unambiguous "fully onboarded" state — a lawyer
  // attestation. Client-only attestation is intentionally NOT a redirect
  // signal here: a lawyer mid-flow has the SCHEMA_CLIENT attestation written
  // (after their PID step) before they present the bar credential, and
  // bouncing them to /client/home would strand their onboarding. Returning
  // clients hit /client/home through WalletButton's own attestation check
  // before they ever touch /connect.
  const status = await getAttestationStatus(wallet);
  if (status.lawyer) {
    // Loop guard: if the JWT still says CLIENT (stale token from before
    // updateSession was wired through both edge-config and config, OR a race
    // between the lawyer/finalize updateSession and the immediate navigation
    // to /lawyer/dashboard), bounce through /sync-role to refresh the JWT
    // from the chain instead of showing the user a sign-out confirmation
    // page mid-onboarding.
    if (session.user.role !== "LAWYER") {
      redirect("/sync-role?to=/lawyer/dashboard");
    }
    redirect("/lawyer/dashboard");
  }

  const sp = await searchParams;
  const initialRole = sp.role === "lawyer" ? "lawyer" : "client";

  return (
    <AuthShell escapeHref="/">
      <ConnectFlow initialRole={initialRole} />
    </AuthShell>
  );
}
