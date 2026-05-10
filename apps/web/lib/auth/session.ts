import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { Role } from "@/lib/db/enums";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";

export async function requireSession() {
  const session = await auth();
  if (!session?.user) redirect("/connect");
  return session;
}

export async function requireClient() {
  const session = await requireSession();
  if (session.user.role !== Role.CLIENT) redirect("/lawyer/dashboard");
  return session;
}

export async function requireLawyer() {
  const session = await requireSession();
  if (session.user.role !== Role.LAWYER) redirect("/client/home");
  return session;
}

export async function requireOperator() {
  const session = await requireSession();
  if (session.user.role !== Role.OPERATOR) redirect("/");
  return session;
}

/**
 * Resolve the *current* User row by walletAddress (the stable identifier),
 * not the JWT's cuid. Use this in any Node-runtime handler that writes
 * foreign-key references to the user — the JWT can carry a stale id after a
 * DB reseed. Returns null if no session or the wallet has no user row.
 *
 * The returned object also carries `devLogin` from the session — true when
 * authenticated via the dev-login bypass (no real wallet), so endpoints that
 * gate on per-action wallet signatures can skip the check for fixture users
 * in tests + local dev.
 */
export async function getCurrentUser(): Promise<(User & { devLogin: boolean }) | null> {
  const session = await auth();
  const wallet = session?.user?.walletAddress;
  if (!wallet) return null;
  const row = await prisma.user.findUnique({ where: { walletAddress: wallet } });
  if (!row) return null;
  return { ...row, devLogin: session.user.devLogin === true };
}
