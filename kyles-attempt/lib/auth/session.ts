import { redirect } from "next/navigation";
import { Role, type User } from "@prisma/client";
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
